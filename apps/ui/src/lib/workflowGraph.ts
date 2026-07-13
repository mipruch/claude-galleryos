/**
 * Workflow canvas graph adapters — pure functions turning data the admin
 * already manages (mappings, schedules, trigger actions, scenes, devices, a
 * scene's actions) into Vue Flow nodes/edges. Nothing here is a new execution
 * concept: the routing map is a spatial view over `input_mappings` /
 * `scheduled_jobs` and the `trigger_actions` wired to them, and a scene's
 * canvas is a spatial view over `scene_actions` (`parallelGroup` stages, same
 * shape `SceneEngine.planGroups` executes).
 *
 * Two graphs:
 *   - `buildRoutingGraph`  — a 3-tier graph: trigger (mapping/schedule) → its
 *     0..N wired trigger actions → each action's resolved target (scene or
 *     device), plus a trailing "add action" button per trigger. A trigger or an
 *     action with nothing resolved yet is a normal, valid state (a schedule/
 *     mapping is savable with zero actions; an action is savable with no
 *     target) — the dispatcher just skips it at fire time, and the canvas
 *     renders it as a dangling/dashed node rather than refusing to show it.
 *   - `buildSceneStageGraph` — one scene's actions laid out as an ordered
 *     sequence of "stage" columns (one per distinct `parallelGroup`), each
 *     holding its parallel actions. There is deliberately no action-to-action
 *     edge: the engine has no per-action dependency concept, only group
 *     barriers, so drawing one would misrepresent what actually runs.
 */

import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@vue-flow/core'
import type { DeviceDTO, InputMappingDTO, ScheduledJobDTO, SceneDTO, TriggerActionDTO } from '@gallery/types'
import type { EditAction } from './sceneActions'

// ── node id namespacing (shared prefix so click/connect handlers can tell
//    node kinds apart without a lookup; only `parseNodeId` — the reverse
//    direction — is needed outside this module) ──────────────────────────

export type TriggerOwnerKind = 'mapping' | 'schedule'

// Only the ids the view needs to build itself (for newly-created rows and
// deep-link selection) are exported; scene/device/add-action ids are only
// ever built from inside this module's own graph-construction helpers.
export const mappingNodeId = (id: string): string => `mapping:${id}`
export const scheduleNodeId = (id: string): string => `schedule:${id}`
export const actionNodeId = (id: string): string => `action:${id}`
const sceneNodeId = (id: string): string => `scene:${id}`
const deviceNodeId = (id: string): string => `device:${id}`
const addActionNodeId = (ownerKind: TriggerOwnerKind, ownerId: string): string =>
  `add-action:${ownerKind}:${ownerId}`
const actionStageNodeId = (key: string): string => `action:${key}`
const stageNodeId = (groupIndex: number): string => `stage:${groupIndex}`
const START_NODE_ID = 'start'

/** Split a namespaced node id (`"mapping:<uuid>"`) back into its kind and raw value. */
export function parseNodeId(id: string): { kind: string; value: string } {
  const i = id.indexOf(':')
  return i === -1 ? { kind: id, value: '' } : { kind: id.slice(0, i), value: id.slice(i + 1) }
}

/** Split an `add-action:<ownerKind>:<ownerId>` node's value back into its parts. */
export function parseAddActionValue(value: string): { ownerKind: TriggerOwnerKind; ownerId: string } {
  const i = value.indexOf(':')
  return { ownerKind: value.slice(0, i) as TriggerOwnerKind, ownerId: value.slice(i + 1) }
}

// ── routing-map graph ─────────────────────────────────────────────────────

export type RoutingNodeData =
  | { kind: 'mapping'; mapping: InputMappingDTO }
  | { kind: 'schedule'; schedule: ScheduledJobDTO }
  | { kind: 'action'; action: TriggerActionDTO }
  | { kind: 'scene'; scene: SceneDTO }
  | { kind: 'device'; device: DeviceDTO }
  | { kind: 'add-action'; ownerKind: TriggerOwnerKind; ownerId: string }

export type RoutingNode = Node<RoutingNodeData>

export interface RoutingGraphInput {
  mappings: InputMappingDTO[]
  schedules: ScheduledJobDTO[]
  triggerActions: TriggerActionDTO[]
  scenes: SceneDTO[]
  devices: DeviceDTO[]
}

const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target })

/** Mutable accumulator threaded through the routing-map builder helpers below. */
interface RoutingBuilder {
  nodes: RoutingNode[]
  edges: Edge[]
  pinned: Set<string>
  deviceIds: Set<string>
}

function addRoutingNode(b: RoutingBuilder, node: RoutingNode, savedPosition?: { x: number; y: number } | null): void {
  if (savedPosition) b.pinned.add(node.id)
  b.nodes.push({ ...node, position: savedPosition ?? { x: 0, y: 0 } })
}

/** One trigger node (mapping or schedule) plus its trailing "add action" button. */
function addTriggerNode(
  b: RoutingBuilder,
  ownerKind: TriggerOwnerKind,
  ownerId: string,
  data: RoutingNodeData,
  savedPosition: { x: number; y: number } | null,
): void {
  const id = ownerKind === 'mapping' ? mappingNodeId(ownerId) : scheduleNodeId(ownerId)
  addRoutingNode(b, { id, type: 'trigger', position: { x: 0, y: 0 }, data }, savedPosition)
  const addId = addActionNodeId(ownerKind, ownerId)
  b.nodes.push({
    id: addId,
    type: 'add',
    position: { x: 0, y: 0 },
    data: { kind: 'add-action', ownerKind, ownerId },
    draggable: false,
    connectable: false,
    selectable: false,
  })
  b.edges.push(edge(id, addId))
}

/** One wired-or-not trigger action: an edge from its owning trigger, and (if resolved) one to its target. */
function addActionNode(b: RoutingBuilder, action: TriggerActionDTO): void {
  const id = actionNodeId(action.id)
  const ownerId = action.mappingId ?? action.scheduleId
  if (!ownerId) return // schema-invalid row (neither owner set); nothing sane to render.
  const ownerNodeId = action.mappingId ? mappingNodeId(action.mappingId) : scheduleNodeId(action.scheduleId!)

  addRoutingNode(b, { id, type: 'action', position: { x: 0, y: 0 }, data: { kind: 'action', action } }, action.position)
  b.edges.push(edge(ownerNodeId, id))

  if (action.targetType === 'scene.execute' && action.targetId) {
    b.edges.push(edge(id, sceneNodeId(action.targetId)))
  } else if (action.targetType === 'device.command' && action.targetId) {
    b.deviceIds.add(action.targetId)
    b.edges.push(edge(id, deviceNodeId(action.targetId)))
  }
  // No targetId yet: the action node is a dangling dead end — a normal state
  // for an action dropped on the canvas before its target is picked.
}

// Scenes are always shown (a bounded, admin-managed list) so one can be wired
// up from a fresh trigger action with nothing dragged onto it yet. Devices can
// be numerous, so only ones a trigger action already resolves to are shown —
// picking a new device target happens in the action's inspector, at which
// point its node appears here automatically.
function addTargetNodes(b: RoutingBuilder, scenes: SceneDTO[], devices: DeviceDTO[]): void {
  for (const scene of scenes) {
    addRoutingNode(b, { id: sceneNodeId(scene.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'scene', scene } })
  }
  for (const device of devices.filter((d) => b.deviceIds.has(d.id))) {
    addRoutingNode(b, { id: deviceNodeId(device.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'device', device } })
  }
}

/**
 * Build the trigger-routing map: one node per mapping/schedule (trigger), one
 * per trigger action wired to it (0..N), one per scene (always) and device
 * (only if some action targets it), plus a trailing "add action" button per
 * trigger.
 */
export function buildRoutingGraph(input: RoutingGraphInput): { nodes: RoutingNode[]; edges: Edge[] } {
  const b: RoutingBuilder = { nodes: [], edges: [], pinned: new Set(), deviceIds: new Set() }
  for (const mapping of input.mappings) {
    addTriggerNode(b, 'mapping', mapping.id, { kind: 'mapping', mapping }, mapping.position)
  }
  for (const schedule of input.schedules) {
    addTriggerNode(b, 'schedule', schedule.id, { kind: 'schedule', schedule }, schedule.position)
  }
  for (const action of input.triggerActions) addActionNode(b, action)
  addTargetNodes(b, input.scenes, input.devices)
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
