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
 *   - `buildRoutingGraph` — a 2-tier graph: one node per trigger
 *     (mapping/schedule) and per placed-or-wired target (scene/device), one
 *     edge per `trigger_action` connecting a trigger straight to its target.
 *     The action has no node of its own — its id and full row travel as the
 *     edge's `data`, so selecting the edge is how its inspector opens. An
 *     edge needs both endpoints to exist, so creating a trigger action *is*
 *     drawing a connection from an already-visible trigger to an
 *     already-visible target — there is no "floating, unwired action" state
 *     to render any more. `unplacedLibraryItems` is the complementary view:
 *     the scenes/devices not yet on the canvas, for the drag-and-drop library
 *     panel — dropping one gives it a position and `buildRoutingGraph` starts
 *     rendering it, so a trigger can then be wired to it.
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
// deep-link selection) are exported; scene/device node ids are only ever
// built from inside this module's own graph-construction helpers — the view
// only ever consumes them back out via `parseNodeId`.
export const mappingNodeId = (id: string): string => `mapping:${id}`
export const scheduleNodeId = (id: string): string => `schedule:${id}`
/** A trigger action's edge id — carries no positional meaning, just identity. */
export const triggerActionEdgeId = (id: string): string => `trigger-action:${id}`
const sceneNodeId = (id: string): string => `scene:${id}`
const deviceNodeId = (id: string): string => `device:${id}`
const actionStageNodeId = (key: string): string => `action:${key}`
const stageNodeId = (groupIndex: number): string => `stage:${groupIndex}`
const START_NODE_ID = 'start'

/** Split a namespaced node id (`"mapping:<uuid>"`) back into its kind and raw value. */
export function parseNodeId(id: string): { kind: string; value: string } {
  const i = id.indexOf(':')
  return i === -1 ? { kind: id, value: '' } : { kind: id.slice(0, i), value: id.slice(i + 1) }
}

// ── routing-map graph ─────────────────────────────────────────────────────

export type RoutingNodeData =
  | { kind: 'mapping'; mapping: InputMappingDTO }
  | { kind: 'schedule'; schedule: ScheduledJobDTO }
  | { kind: 'scene'; scene: SceneDTO }
  | { kind: 'device'; device: DeviceDTO }

export type RoutingNode = Node<RoutingNodeData>

export interface RoutingEdgeData {
  triggerAction: TriggerActionDTO
}

export type RoutingEdge = Edge<RoutingEdgeData>

export interface RoutingGraphInput {
  mappings: InputMappingDTO[]
  schedules: ScheduledJobDTO[]
  triggerActions: TriggerActionDTO[]
  scenes: SceneDTO[]
  devices: DeviceDTO[]
}

/** Mutable accumulator threaded through the routing-map builder helpers below. */
interface RoutingBuilder {
  nodes: RoutingNode[]
  edges: RoutingEdge[]
  pinned: Set<string>
  referencedSceneIds: Set<string>
  referencedDeviceIds: Set<string>
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

/** Which scenes/devices have at least one trigger action wired to them. */
function partitionReferencedTargets(actions: TriggerActionDTO[]): { sceneIds: Set<string>; deviceIds: Set<string> } {
  const sceneIds = new Set<string>()
  const deviceIds = new Set<string>()
  for (const action of actions) {
    if (!action.targetId) continue
    if (action.targetType === 'scene.execute') sceneIds.add(action.targetId)
    else if (action.targetType === 'device.command') deviceIds.add(action.targetId)
  }
  return { sceneIds, deviceIds }
}

/**
 * One edge per wired trigger action, straight from its owning trigger to its
 * target. A row with no owner (schema-invalid) or no target (unwired) has
 * nothing sane to draw and is skipped — the latter can now only happen to a
 * legacy row, since the canvas itself can no longer create an unwired one
 * (see module doc).
 */
function addTriggerActionEdges(b: RoutingBuilder, actions: TriggerActionDTO[]): void {
  for (const action of actions) {
    const ownerId = action.mappingId ?? action.scheduleId
    if (!ownerId || !action.targetId) continue
    const ownerNodeId = action.mappingId ? mappingNodeId(action.mappingId) : scheduleNodeId(action.scheduleId!)
    const targetNodeId =
      action.targetType === 'scene.execute' ? sceneNodeId(action.targetId) : deviceNodeId(action.targetId)
    b.edges.push({
      id: triggerActionEdgeId(action.id),
      source: ownerNodeId,
      target: targetNodeId,
      data: { triggerAction: action },
    })
  }
}

// A scene/device only becomes a canvas node once it's either been placed
// there (a saved `position`, set by dropping it from the library panel) or
// some trigger action is already wired to it (so existing wiring is never
// hidden by a target nobody has explicitly placed) — everything else lives
// in the library instead (see `unplacedLibraryItems`).
function addTargetNodes(b: RoutingBuilder, scenes: SceneDTO[], devices: DeviceDTO[]): void {
  for (const scene of scenes) {
    if (scene.position == null && !b.referencedSceneIds.has(scene.id)) continue
    addRoutingNode(
      b,
      { id: sceneNodeId(scene.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'scene', scene } },
      scene.position,
    )
  }
  for (const device of devices) {
    if (device.position == null && !b.referencedDeviceIds.has(device.id)) continue
    addRoutingNode(
      b,
      { id: deviceNodeId(device.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'device', device } },
      device.position,
    )
  }
}

/**
 * Build the trigger-routing map: one node per mapping/schedule (trigger), one
 * per placed-or-wired scene/device (target), and one edge per trigger action
 * connecting a trigger straight to its target.
 */
export function buildRoutingGraph(input: RoutingGraphInput): { nodes: RoutingNode[]; edges: RoutingEdge[] } {
  const { sceneIds: referencedSceneIds, deviceIds: referencedDeviceIds } = partitionReferencedTargets(
    input.triggerActions,
  )
  const b: RoutingBuilder = { nodes: [], edges: [], pinned: new Set(), referencedSceneIds, referencedDeviceIds }
  for (const mapping of input.mappings) {
    addTriggerNode(b, 'mapping', mapping.id, { kind: 'mapping', mapping }, mapping.position)
  }
  for (const schedule of input.schedules) {
    addTriggerNode(b, 'schedule', schedule.id, { kind: 'schedule', schedule }, schedule.position)
  }
  addTriggerActionEdges(b, input.triggerActions)
  addTargetNodes(b, input.scenes, input.devices)
  return { nodes: layoutUnpinned(b.nodes, b.edges, b.pinned), edges: b.edges }
}

export interface LibraryItems {
  scenes: SceneDTO[]
  devices: DeviceDTO[]
}

/**
 * Scenes/devices not currently on the routing map — no saved position and no
 * trigger action wired to them yet — for the drag-and-drop library panel.
 * The complement of what `addTargetNodes` renders.
 */
export function unplacedLibraryItems(input: RoutingGraphInput): LibraryItems {
  const { sceneIds: referencedSceneIds, deviceIds: referencedDeviceIds } = partitionReferencedTargets(
    input.triggerActions,
  )
  return {
    scenes: input.scenes.filter((s) => s.position == null && !referencedSceneIds.has(s.id)),
    devices: input.devices.filter((d) => d.position == null && !referencedDeviceIds.has(d.id)),
  }
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
