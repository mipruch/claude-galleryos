/**
 * Workflow canvas graph adapters — pure functions turning data the admin
 * already manages (mappings, schedules, scenes, devices, a scene's actions)
 * into Vue Flow nodes/edges. Nothing here is a new execution concept: the
 * routing map is a spatial view over `input_mappings` + `scheduled_jobs`
 * targets, and a scene's canvas is a spatial view over `scene_actions`
 * (`parallelGroup` stages, same shape `SceneEngine.planGroups` executes).
 *
 * Two graphs:
 *   - `buildRoutingGraph`  — triggers (mappings/schedules) → their resolved
 *     target (scene/device), plus a terminal node per `event.emit` mapping.
 *   - `buildSceneStageGraph` — one scene's actions laid out as an ordered
 *     sequence of "stage" columns (one per distinct `parallelGroup`), each
 *     holding its parallel actions. There is deliberately no action-to-action
 *     edge: the engine has no per-action dependency concept, only group
 *     barriers, so drawing one would misrepresent what actually runs.
 */

import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@vue-flow/core'
import type { DeviceDTO, InputMappingDTO, ScheduledJobDTO, SceneDTO } from '@gallery/types'
import type { EditAction } from './sceneActions'

// ── node id namespacing (shared prefix so click/connect handlers can tell
//    node kinds apart without a lookup; only `parseNodeId` — the reverse
//    direction — is needed outside this module) ──────────────────────────

const mappingNodeId = (id: string): string => `mapping:${id}`
const scheduleNodeId = (id: string): string => `schedule:${id}`
const sceneNodeId = (id: string): string => `scene:${id}`
const deviceNodeId = (id: string): string => `device:${id}`
const eventNodeId = (mappingId: string): string => `event:${mappingId}`
const actionNodeId = (key: string): string => `action:${key}`
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
  | { kind: 'event'; mapping: InputMappingDTO }

export type RoutingNode = Node<RoutingNodeData>

export interface RoutingGraphInput {
  mappings: InputMappingDTO[]
  schedules: ScheduledJobDTO[]
  scenes: SceneDTO[]
  devices: DeviceDTO[]
}

const edge = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target })

/** Mutable accumulator threaded through the routing-map builder helpers below. */
interface RoutingBuilder {
  nodes: RoutingNode[]
  edges: Edge[]
  pinned: Set<string>
  sceneIds: Set<string>
  deviceIds: Set<string>
}

function addRoutingNode(b: RoutingBuilder, node: RoutingNode, savedPosition?: { x: number; y: number } | null): void {
  if (savedPosition) b.pinned.add(node.id)
  b.nodes.push({ ...node, position: savedPosition ?? { x: 0, y: 0 } })
}

/** One trigger node, plus whatever it currently resolves to (a target node/edge, or nothing yet). */
function addMappingNode(b: RoutingBuilder, mapping: InputMappingDTO): void {
  const id = mappingNodeId(mapping.id)
  addRoutingNode(b, { id, type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'mapping', mapping } }, mapping.position)

  if (mapping.targetType === 'scene.execute' && mapping.targetId) {
    b.sceneIds.add(mapping.targetId)
    b.edges.push(edge(id, sceneNodeId(mapping.targetId)))
  } else if (mapping.targetType === 'device.command' && mapping.targetId) {
    b.deviceIds.add(mapping.targetId)
    b.edges.push(edge(id, deviceNodeId(mapping.targetId)))
  } else if (mapping.targetType === 'event.emit') {
    addRoutingNode(b, { id: eventNodeId(mapping.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'event', mapping } })
    b.edges.push(edge(id, eventNodeId(mapping.id)))
  }
  // Any other state (e.g. mid-edit with no targetId yet) is a dangling trigger
  // node — the server already refuses to save one, so it's transient, not
  // something the canvas needs to render specially.
}

/** A schedule always targets exactly one scene (required by the schema), so there's no branching here. */
function addScheduleNode(b: RoutingBuilder, schedule: ScheduledJobDTO): void {
  const id = scheduleNodeId(schedule.id)
  addRoutingNode(b, { id, type: 'trigger', position: { x: 0, y: 0 }, data: { kind: 'schedule', schedule } }, schedule.position)
  b.sceneIds.add(schedule.sceneId)
  b.edges.push(edge(id, sceneNodeId(schedule.sceneId)))
}

// Target nodes (scenes/devices) have no position column of their own — they're
// shared entities referenced from elsewhere, not owned by the canvas — so they
// always auto-layout; only trigger rows persist a manual position.
function addTargetNodes(b: RoutingBuilder, scenes: SceneDTO[], devices: DeviceDTO[]): void {
  for (const scene of scenes.filter((s) => b.sceneIds.has(s.id))) {
    addRoutingNode(b, { id: sceneNodeId(scene.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'scene', scene } })
  }
  for (const device of devices.filter((d) => b.deviceIds.has(d.id))) {
    addRoutingNode(b, { id: deviceNodeId(device.id), type: 'target', position: { x: 0, y: 0 }, data: { kind: 'device', device } })
  }
}

/**
 * Build the trigger-routing map: one node per mapping/schedule (trigger) and
 * per scene/device they resolve to, with an edge for each resolved target.
 */
export function buildRoutingGraph(input: RoutingGraphInput): { nodes: RoutingNode[]; edges: Edge[] } {
  const b: RoutingBuilder = { nodes: [], edges: [], pinned: new Set(), sceneIds: new Set(), deviceIds: new Set() }
  for (const mapping of input.mappings) addMappingNode(b, mapping)
  for (const schedule of input.schedules) addScheduleNode(b, schedule)
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
  for (const n of nodes) g.setNode(n.id, DAGRE_NODE_SIZE)
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

export type StageNode = Node<StageGraphNodeData>

const COLUMN_WIDTH = 280
const STAGE_ROW_Y = 0
const ACTION_START_Y = 130
const ACTION_ROW_HEIGHT = 108

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

    // Sort by saved y when present; a stable sort falls back to the actions
    // array's existing order (last-saved stepOrder) for the rest.
    ;[...actionsInGroup]
      .sort((a, b) => (a.position?.y ?? 0) - (b.position?.y ?? 0))
      .forEach((action, rowIndex) => {
        // x always tracks the current column (even if a stale saved x drifted
        // from a parallelGroup edited elsewhere); only y is user-arranged.
        const y = action.position?.y ?? ACTION_START_Y + rowIndex * ACTION_ROW_HEIGHT
        nodes.push({
          id: actionNodeId(action.key),
          type: 'action',
          position: { x: columnCenterX(groupIndex), y },
          data: { kind: 'action', action, index: actions.indexOf(action) },
          connectable: false,
        })
      })
  })

  return { nodes, columnCount: groups.length }
}
