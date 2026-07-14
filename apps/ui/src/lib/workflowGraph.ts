/**
 * Workflow canvas graph adapters — pure functions turning data the admin
 * already manages (mappings, schedules, trigger actions, workflow targets, a
 * scene's actions) into Vue Flow nodes/edges. Nothing here is a new execution
 * concept: the routing map is a spatial view over `input_mappings` /
 * `scheduled_jobs`, the `workflow_targets` a trigger can fire, and the
 * `trigger_actions` wiring one to the other; a scene's canvas is a spatial
 * view over `scene_actions` (`parallelGroup` stages, same shape
 * `SceneEngine.planGroups` executes).
 *
 * Two graphs:
 *   - `buildRoutingGraph` — a 2-tier graph: one node per trigger
 *     (mapping/schedule) and one per `workflow_targets` row (a placed,
 *     independently-configured scene run or device command — a scene/device
 *     may have any number of these, e.g. separate "on" and "off" instances of
 *     the same device), one edge per `trigger_action` connecting a trigger
 *     straight to the instance it fires. A `workflow_targets` row always
 *     carries a position (existence on that table *is* placement, see
 *     `packages/types/src/records.ts`), so unlike a trigger there's no
 *     "floating, not yet on the canvas" state to lay out — every instance
 *     renders unconditionally. A wire is a pure link with nothing of its own
 *     to configure — command/params live on the target node, opened by
 *     selecting it — so `RoutingEdgeData` carries just enough to render a
 *     hover tooltip: the named path-params (`patternParamNames`) the owning
 *     mapping's pattern captures, if any, mirrored onto the target node as
 *     `availableArgs` (the union across every incoming mapping-owned wire)
 *     for its inspector to show "available from this wire."
 *   - `buildSceneStageGraph` — one scene's actions laid out as an ordered
 *     sequence of "stage" columns (one per distinct `parallelGroup`), each
 *     holding its parallel actions. There is deliberately no action-to-action
 *     edge: the engine has no per-action dependency concept, only group
 *     barriers, so drawing one would misrepresent what actually runs.
 */

import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@vue-flow/core'
import type { DeviceDTO, InputMappingDTO, ScheduledJobDTO, SceneDTO, TriggerActionDTO, WorkflowTargetDTO } from '@gallery/types'
import type { EditAction } from './sceneActions'

// ── node id namespacing (shared prefix so click/connect handlers can tell
//    node kinds apart without a lookup; only `parseNodeId` — the reverse
//    direction — is needed outside this module) ──────────────────────────

export type TriggerOwnerKind = 'mapping' | 'schedule'

// Only the ids the view needs to build itself (for newly-created rows and
// deep-link selection) are exported; other node ids are only ever built from
// inside this module's own graph-construction helpers — the view only ever
// consumes them back out via `parseNodeId`.
export const mappingNodeId = (id: string): string => `mapping:${id}`
export const scheduleNodeId = (id: string): string => `schedule:${id}`
export const targetNodeId = (id: string): string => `target:${id}`
/** A trigger action's edge id — carries no positional meaning, just identity. Internal: no view code needs to build one (see module doc). */
const triggerActionEdgeId = (id: string): string => `trigger-action:${id}`
const actionStageNodeId = (key: string): string => `action:${key}`
const stageNodeId = (groupIndex: number): string => `stage:${groupIndex}`
const START_NODE_ID = 'start'

/** Split a namespaced node id (`"mapping:<uuid>"`) back into its kind and raw value. */
export function parseNodeId(id: string): { kind: string; value: string } {
  const i = id.indexOf(':')
  return i === -1 ? { kind: id, value: '' } : { kind: id.slice(0, i), value: id.slice(i + 1) }
}

/**
 * Named `:param` segments of a mapping pattern, in order — the args a matched
 * signal makes available to its wired trigger actions' param templates.
 * Mirrors the split-based algorithm `input/patterns.ts` compiles server-side
 * (no regex): a segment starting with `:` is a named wildcard, everything
 * else is a literal to match as-is.
 */
export function patternParamNames(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1))
}

// ── routing-map graph ─────────────────────────────────────────────────────

export type RoutingNodeData =
  | { kind: 'mapping'; mapping: InputMappingDTO }
  | { kind: 'schedule'; schedule: ScheduledJobDTO }
  | {
      kind: 'target'
      target: WorkflowTargetDTO
      scene?: SceneDTO
      device?: DeviceDTO
      /** Named signal args available from every incoming mapping-owned wire, deduped. */
      availableArgs: string[]
      /** Whether at least one incoming wire is mapping-owned — a signal to template against even if its pattern captures no named args (positional `{arg[N]}`). */
      hasSignalWire: boolean
    }

export type RoutingNode = Node<RoutingNodeData>

export interface RoutingEdgeData {
  triggerAction: TriggerActionDTO
  /** Named path-params the owning mapping's pattern captures — empty for a schedule-owned wire, or a mapping with none. */
  signalArgs: string[]
}

export type RoutingEdge = Edge<RoutingEdgeData>

export interface RoutingGraphInput {
  mappings: InputMappingDTO[]
  schedules: ScheduledJobDTO[]
  triggerActions: TriggerActionDTO[]
  workflowTargets: WorkflowTargetDTO[]
  scenes: SceneDTO[]
  devices: DeviceDTO[]
}

/** Mutable accumulator threaded through the routing-map builder helpers below. */
interface RoutingBuilder {
  nodes: RoutingNode[]
  edges: RoutingEdge[]
  pinned: Set<string>
}

function addRoutingNode(b: RoutingBuilder, node: RoutingNode, savedPosition?: { x: number; y: number } | null): void {
  if (savedPosition) b.pinned.add(node.id)
  b.nodes.push({ ...node, position: savedPosition ?? { x: 0, y: 0 } })
}

/** One trigger node (mapping or schedule). */
function addTriggerNode(
  b: RoutingBuilder,
  ownerKind: TriggerOwnerKind,
  ownerId: string,
  data: RoutingNodeData,
  savedPosition: { x: number; y: number } | null,
): void {
  const id = ownerKind === 'mapping' ? mappingNodeId(ownerId) : scheduleNodeId(ownerId)
  addRoutingNode(b, { id, type: 'trigger', position: { x: 0, y: 0 }, data }, savedPosition)
}

/**
 * One edge per wired trigger action, straight from its owning trigger to the
 * workflow-target instance it fires. A row with no owner (schema-invalid) has
 * nothing sane to draw and is skipped; every other row is guaranteed a real
 * target (`workflowTargetId` is a NOT NULL FK), so there is no "unwired"
 * state to check for any more.
 */
function addTriggerActionEdges(b: RoutingBuilder, actions: TriggerActionDTO[], mappings: InputMappingDTO[]): void {
  for (const action of actions) {
    const ownerId = action.mappingId ?? action.scheduleId
    if (!ownerId) continue
    const ownerNodeId = action.mappingId ? mappingNodeId(action.mappingId) : scheduleNodeId(action.scheduleId!)
    const mapping = action.mappingId ? mappings.find((m) => m.id === action.mappingId) : undefined
    b.edges.push({
      id: triggerActionEdgeId(action.id),
      type: 'trigger-action',
      source: ownerNodeId,
      target: targetNodeId(action.workflowTargetId),
      data: { triggerAction: action, signalArgs: mapping ? patternParamNames(mapping.pattern) : [] },
    })
  }
}

/**
 * One node per `workflow_targets` row, unconditionally — existence on that
 * table *is* placement, so (unlike a trigger) there is no unplaced state to
 * filter by. Each carries the union of its incoming mapping-owned wires'
 * signal args, for the inspector to show what's available to template against.
 */
function addTargetNodes(b: RoutingBuilder, targets: WorkflowTargetDTO[], scenes: SceneDTO[], devices: DeviceDTO[]): void {
  for (const target of targets) {
    const scene = target.targetType === 'scene.execute' ? scenes.find((s) => s.id === target.targetId) : undefined
    const device = target.targetType === 'device.command' ? devices.find((d) => d.id === target.targetId) : undefined
    const incomingEdges = b.edges.filter((edge) => edge.target === targetNodeId(target.id))
    const incomingArgs = incomingEdges.flatMap((edge) => edge.data?.signalArgs ?? [])
    const hasSignalWire = incomingEdges.some((edge) => !!edge.data?.triggerAction.mappingId)
    addRoutingNode(
      b,
      {
        id: targetNodeId(target.id),
        type: 'target',
        position: { x: 0, y: 0 },
        data: { kind: 'target', target, scene, device, availableArgs: [...new Set(incomingArgs)], hasSignalWire },
      },
      target.position,
    )
  }
}

/**
 * Build the trigger-routing map: one node per mapping/schedule (trigger), one
 * per placed `workflow_targets` instance, and one edge per trigger action
 * connecting a trigger straight to the instance it fires.
 */
export function buildRoutingGraph(input: RoutingGraphInput): { nodes: RoutingNode[]; edges: RoutingEdge[] } {
  const b: RoutingBuilder = { nodes: [], edges: [], pinned: new Set() }
  for (const mapping of input.mappings) {
    addTriggerNode(b, 'mapping', mapping.id, { kind: 'mapping', mapping }, mapping.position)
  }
  for (const schedule of input.schedules) {
    addTriggerNode(b, 'schedule', schedule.id, { kind: 'schedule', schedule }, schedule.position)
  }
  // Edges before target nodes: a target's `availableArgs` is derived from its incoming edges.
  addTriggerActionEdges(b, input.triggerActions, input.mappings)
  addTargetNodes(b, input.workflowTargets, input.scenes, input.devices)
  return { nodes: layoutUnpinned(b.nodes, b.edges, b.pinned), edges: b.edges }
}

const DAGRE_NODE_SIZE = { width: 240, height: 72 }

/** Run dagre over the whole graph for spacing, but keep any `pinned` node exactly where it was saved. */
function layoutUnpinned<D>(nodes: Node<D>[], edges: Edge[], pinned: Set<string>): Node<D>[] {
  if (!nodes.length) return nodes
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 })
  // A fresh object per node: dagre writes each node's computed x/y back onto
  // the exact object passed to setNode, so sharing one DAGRE_NODE_SIZE
  // reference across every call would let the last-processed node's position
  // overwrite the label every other node's lookup also points to.
  for (const n of nodes) g.setNode(n.id, { ...DAGRE_NODE_SIZE })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)

  return nodes.map((n) => {
    if (pinned.has(n.id)) return n
    const pos = g.node(n.id)
    return { ...n, position: { x: pos.x - DAGRE_NODE_SIZE.width / 2, y: pos.y - DAGRE_NODE_SIZE.height / 2 } }
  })
}

// ── scene stage graph (drill-down) ────────────────────────────────────────

export type StageGraphNodeData =
  | { kind: 'start' }
  | { kind: 'stage'; groupIndex: number; count: number }
  | { kind: 'action'; action: EditAction; index: number }
  /** "+" under an existing stage's actions — adds a new action into that stage. */
  | { kind: 'add-action'; groupIndex: number }
  /** "+" after the last stage — adds a new action into a brand new trailing stage. */
  | { kind: 'add-stage' }

export type StageNode = Node<StageGraphNodeData>

const COLUMN_WIDTH = 280
const STAGE_ROW_Y = 0
const ACTION_START_Y = 130
const ACTION_ROW_HEIGHT = 108
const addActionInStageNodeId = (groupIndex: number): string => `add-action:${groupIndex}`
const ADD_STAGE_NODE_ID = 'add-stage'

const columnCenterX = (groupIndex: number): number => (groupIndex + 1) * COLUMN_WIDTH

/** Distinct `parallelGroup` values present, sorted ascending — the canonical column order. */
export function distinctGroups(actions: EditAction[]): number[] {
  return [...new Set(actions.map((a) => Number(a.parallelGroup) || 0))].sort((x, y) => x - y)
}

/**
 * Order actions for save: by `parallelGroup` ascending, then by on-canvas y —
 * a stepOrder that reads top-to-bottom, left-to-right the way the canvas shows it.
 */
export function orderActionsForSave(actions: EditAction[]): EditAction[] {
  return [...actions].sort((a, b) => {
    const groupDiff = (Number(a.parallelGroup) || 0) - (Number(b.parallelGroup) || 0)
    return groupDiff !== 0 ? groupDiff : (a.position?.y ?? 0) - (b.position?.y ?? 0)
  })
}

/** Nearest existing column to an x-coordinate, clamped — dragging can't create a new stage (use "Add action"). */
export function columnIndexFromX(x: number, columnCount: number): number {
  if (columnCount <= 0) return 0
  const idx = Math.round(x / COLUMN_WIDTH) - 1
  return Math.min(Math.max(idx, 0), columnCount - 1)
}

export interface StageGraph {
  nodes: StageNode[]
  /** Number of stage columns currently rendered. */
  columnCount: number
}

/**
 * Lay a scene's actions out as stage columns. `parallelGroup` values are
 * normalized to their sort rank here (0, 1, 2, …) purely for column position;
 * the actual values written back on save come from each action's column index
 * at that time (see `WorkflowSceneView`), not whatever was last persisted —
 * so gaps left by a deleted stage never accumulate.
 *
 * No edges: the engine has no per-action dependency, only group barriers
 * (`SceneEngine.planGroups`), so a node-to-node line would claim a dependency
 * that isn't real. Column position + the stage header alone communicate
 * "these run after that, these run alongside each other."
 */
export function buildSceneStageGraph(actions: EditAction[]): StageGraph {
  const groups = distinctGroups(actions)
  const nodes: StageNode[] = []

  nodes.push({
    id: START_NODE_ID,
    type: 'stage',
    position: { x: 0, y: STAGE_ROW_Y },
    data: { kind: 'start' },
    draggable: false,
    connectable: false,
  })

  groups.forEach((group, groupIndex) => {
    const actionsInGroup = actions.filter((a) => (Number(a.parallelGroup) || 0) === group)

    nodes.push({
      id: stageNodeId(groupIndex),
      type: 'stage',
      position: { x: columnCenterX(groupIndex), y: STAGE_ROW_Y },
      data: { kind: 'stage', groupIndex, count: actionsInGroup.length },
      draggable: false,
      connectable: false,
    })

    // Saved y only decides *order* here (sort key), never the literal render
    // position — two actions can otherwise land close enough to visually
    // overlap (e.g. one dragged to y:134 next to an unpositioned sibling
    // whose fallback is y:130). Rendering always at a fixed row spacing
    // keeps a column collision-free; a stable sort falls back to the
    // actions array's existing order (last-saved stepOrder) for ties.
    let lastActionY = ACTION_START_Y
    ;[...actionsInGroup]
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
      .forEach((action, rowIndex) => {
        // x always tracks the current column (even if a stale saved x drifted
        // from a parallelGroup edited elsewhere).
        const y = ACTION_START_Y + rowIndex * ACTION_ROW_HEIGHT
        lastActionY = y
        nodes.push({
          id: actionStageNodeId(action.key),
          type: 'action',
          position: { x: columnCenterX(groupIndex), y },
          data: { kind: 'action', action, index: actions.indexOf(action) },
          connectable: false,
        })
      })

    nodes.push({
      id: addActionInStageNodeId(groupIndex),
      type: 'add',
      position: { x: columnCenterX(groupIndex), y: lastActionY + ACTION_ROW_HEIGHT },
      data: { kind: 'add-action', groupIndex },
      draggable: false,
      connectable: false,
      selectable: false,
    })
  })

  nodes.push({
    id: ADD_STAGE_NODE_ID,
    type: 'add',
    position: { x: columnCenterX(groups.length), y: STAGE_ROW_Y },
    data: { kind: 'add-stage' },
    draggable: false,
    connectable: false,
    selectable: false,
  })

  return { nodes, columnCount: groups.length }
}
