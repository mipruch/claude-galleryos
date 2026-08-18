<script setup lang="ts">
/**
 * Workflow routing map — a spatial view over the mappings/schedules the admin
 * manages, the `workflow_targets` instances they can fire (a placed,
 * independently-configured scene run or device command — a scene/device may
 * have any number of these), and the `trigger_actions` wiring one to the
 * other. Every node projects an existing row; the canvas adds nothing to the
 * execution model beyond `position` (see `packages/types/src/canvas.ts`).
 *
 * Creation, wiring, editing and deletion all happen here — this is now the
 * only place a trigger gets its name/pattern/cron edited and a target gets
 * its command/params configured (the old MappingFormDialog/ScheduleFormDialog
 * are gone; the Mappings/Schedules admin list pages route "New"/"Edit" here,
 * the latter via `?select=<nodeId>`).
 *
 * A wire (trigger action) has no node of its own and nothing to configure —
 * dragging a connection from a trigger to a target atomically creates one;
 * the edge itself only shows a hover tooltip (signal args its owning
 * mapping's pattern captures) and an inline delete button
 * (`TriggerActionEdge`). Clicking a target node — not the wire — opens its
 * inspector, since command/params live on the target instance (see
 * `workflowGraph.ts`'s module doc): this lets the same device appear as two
 * independent instances, e.g. one "on" and one "off". A target only appears
 * on the canvas once it's been dragged there from the library panel (left
 * sidebar, which always lists every scene/device — placing one always adds a
 * new instance, never "moves" an existing one) or created that way earlier.
 *
 * A scene-type target has nothing else to configure (a scene run takes no
 * params), so its inspector shows a button that opens the shared scene editor
 * (`SceneEditorDialog`, via `useSceneEditor`) over this page instead, rather
 * than navigating away to a separate route.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  VueFlow,
  useNodesInitialized,
  useVueFlow,
  type Connection,
  type EdgeMouseEvent,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { toast } from 'vue-sonner'
import { PlusIcon } from '@lucide/vue'
import { useMappingsStore } from '@/stores/mappings'
import { useSchedulesStore } from '@/stores/schedules'
import { useTriggerActionsStore } from '@/stores/triggerActions'
import { useWorkflowTargetsStore } from '@/stores/workflowTargets'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useRoomsStore } from '@/stores/rooms'
import {
  buildRoutingGraph,
  mappingNodeId,
  parseNodeId,
  scheduleNodeId,
  targetNodeId,
  type RoutingNodeData,
  type RoutingNode,
  type RoutingEdge,
  type TriggerOwnerKind,
} from '@/lib/workflowGraph'
import { readLibraryDragPayload } from '@/lib/libraryDrag'
import { recordRecentLibraryItem } from '@/lib/recentLibraryItems'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import TriggerNode from '@/components/admin/workflow/TriggerNode.vue'
import TargetNode from '@/components/admin/workflow/TargetNode.vue'
import TriggerActionEdge from '@/components/admin/workflow/TriggerActionEdge.vue'
import NodeContextMenu from '@/components/admin/workflow/NodeContextMenu.vue'
import LibraryPanel from '@/components/admin/workflow/LibraryPanel.vue'
import TriggerInspector from '@/components/admin/workflow/TriggerInspector.vue'
import WorkflowTargetInspector from '@/components/admin/workflow/WorkflowTargetInspector.vue'

const router = useRouter()
const route = useRoute()
const mappingsStore = useMappingsStore()
const schedulesStore = useSchedulesStore()
const triggerActionsStore = useTriggerActionsStore()
const workflowTargetsStore = useWorkflowTargetsStore()
const scenesStore = useScenesStore()
const devicesStore = useDevicesStore()
const roomsStore = useRoomsStore()
const { fitView, project, vueFlowRef } = useVueFlow()
const nodesInitialized = useNodesInitialized()

onMounted(async () => {
  await Promise.all([
    mappingsStore.fetchAll(),
    schedulesStore.fetchAll(),
    triggerActionsStore.fetchAll(),
    workflowTargetsStore.fetchAll(),
    scenesStore.fetchAll(),
    devicesStore.fetchAll(),
    roomsStore.init(),
  ])
  // Deep-link from the Mappings/Schedules list pages' Edit action.
  const select = route.query.select
  if (typeof select === 'string') selectedNodeId.value = select
})

/** Toolbar's "N unfinished" count — device-command targets with no command picked yet (an amber "NEEDS COMMAND" card). A not-connected trigger has its own inline badge but isn't tallied here. */
const unfinishedCount = computed(
  () => workflowTargetsStore.records.filter((t) => t.targetType === 'device.command' && !t.targetCommand).length,
)

function saveWorkflow(): void {
  // Every field already round-trips to the server on its own submit/drag —
  // there is no separate staged/dirty state to flush. This is a reassurance
  // action, honest about that: it confirms what's already persisted.
  toast.success('Workflow saved')
}

const graphInput = computed(() => ({
  mappings: mappingsStore.records,
  schedules: schedulesStore.records,
  triggerActions: triggerActionsStore.records,
  workflowTargets: workflowTargetsStore.records,
  scenes: scenesStore.records,
  devices: devicesStore.records,
}))
const graph = computed(() => buildRoutingGraph(graphInput.value))
const nodes = computed<RoutingNode[]>(() => graph.value.nodes)
const edges = computed<RoutingEdge[]>(() => graph.value.edges)

function hasOutgoingWire(nodeId: string): boolean {
  return edges.value.some((e) => e.source === nodeId)
}

// `fit-view-on-init` fits as soon as <VueFlow> mounts — before the fetches
// above resolve and before Vue Flow has measured the real nodes' bounds
// (`useNodesInitialized` stays false until it has), so it locks onto
// whatever the very first, near-empty render happened to be. Fit once the
// current node set is actually measured instead.
watch(nodesInitialized, (ready) => {
  if (ready) void fitView()
})

// ── selection → right-sidebar inspector (hidden when nothing is selected) ──

/** Which inspector (if any) the current selection drives — a single source of truth for the template. */
type Selection =
  | { kind: 'trigger'; data: Extract<RoutingNodeData, { kind: 'mapping' | 'schedule' }> }
  | { kind: 'target'; data: Extract<RoutingNodeData, { kind: 'target' }> }

const selectedNodeId = ref<string | null>(null)
const selection = computed<Selection | null>(() => {
  const data = nodes.value.find((n) => n.id === selectedNodeId.value)?.data
  if (data?.kind === 'mapping' || data?.kind === 'schedule') return { kind: 'trigger', data }
  if (data?.kind === 'target') return { kind: 'target', data }
  return null
})

function clearSelection(): void {
  selectedNodeId.value = null
}

/** Select a just-created node so its inspector opens — a no-op if creation failed. */
function selectNodeIfCreated<T extends { id: string }>(
  created: T | null,
  toNodeId: (id: string) => string,
): void {
  if (!created) return
  selectedNodeId.value = toNodeId(created.id)
}

// Whichever inspector is currently mounted (mutually exclusive, see template)
// exposes its own `remove()` — the Delete shortcut below calls the exact same
// function the inspector's own delete button does, so there's one definition
// of "how to delete the active node," not two.
const triggerInspectorRef = ref<InstanceType<typeof TriggerInspector> | null>(null)
const targetInspectorRef = ref<InstanceType<typeof WorkflowTargetInspector> | null>(null)

/** Elements Delete/Backspace already has its own meaning on — never hijack it there (editing text, picking a Select option). */
const KEY_HANDLING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'])
/** Both keyboards' "delete" key — Mac's sends `Backspace`, Windows/Linux's own `Delete` key sends `Delete`. */
const DELETE_KEYS = new Set(['Delete', 'Backspace'])

/** Delete/Backspace removes the currently active node — same effect as its inspector's own trash button. */
function onWindowKeydown(event: KeyboardEvent): void {
  if (!DELETE_KEYS.has(event.key) || !selection.value) return
  const target = event.target as HTMLElement | null
  if (target && (KEY_HANDLING_TAGS.has(target.tagName) || target.isContentEditable)) return
  event.preventDefault()
  if (selection.value.kind === 'trigger') void triggerInspectorRef.value?.remove()
  else void targetInspectorRef.value?.remove()
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onUnmounted(() => window.removeEventListener('keydown', onWindowKeydown))

// ── canvas interactions ────────────────────────────────────────────────────

/** Toolbar "+": a bare, unwired trigger — selected immediately so the inspector opens for naming it. */
async function createTrigger(kind: TriggerOwnerKind): Promise<void> {
  if (kind === 'mapping') {
    selectNodeIfCreated(
      await mappingsStore.create({
        name: 'New mapping',
        protocol: 'osc',
        pattern: '/',
        enabled: true,
      }),
      mappingNodeId,
    )
    return
  }
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  selectNodeIfCreated(
    await schedulesStore.create({
      name: 'New schedule',
      cron: '0 8 * * *',
      timezone: browserTz,
      enabled: true,
    }),
    scheduleNodeId,
  )
}

/** Every node kind just selects on click — a target's own inspector is where "open the scene editor" now lives. */
function onNodeClick({ node }: NodeMouseEvent): void {
  const { kind } = parseNodeId(node.id)
  if (kind === 'mapping' || kind === 'schedule' || kind === 'target') selectedNodeId.value = node.id
}

const hoveredEdgeId = ref<string | null>(null)
function onEdgeMouseEnter({ edge }: EdgeMouseEvent): void {
  hoveredEdgeId.value = edge.id
}
function onEdgeMouseLeave(): void {
  hoveredEdgeId.value = null
}

type NodePosition = { x: number; y: number }

/** Per-kind position persistence, keyed the same way `parseNodeId` tags a node id. */
const POSITION_UPDATERS: Record<string, (id: string, position: NodePosition) => void> = {
  mapping: (id, position) => void mappingsStore.update(id, { position }),
  schedule: (id, position) => void schedulesStore.update(id, { position }),
  target: (id, position) => void workflowTargetsStore.update(id, { position }),
}

/**
 * Persist every dragged node's position — every kind is draggable and now
 * sticks. `nodes` (not the singular `node`) is every node that actually
 * moved: for a multi-selected drag that's the whole selection, not just the
 * one the pointer grabbed, so each one's move is saved instead of only the
 * grabbed node's (the rest would otherwise snap back to their last-saved spot
 * on the next reactive rebuild).
 */
function onNodeDragStop({ nodes: draggedNodes }: NodeDragEvent): void {
  for (const node of draggedNodes) {
    const { kind, value } = parseNodeId(node.id)
    POSITION_UPDATERS[kind]?.(value, { x: node.position.x, y: node.position.y })
  }
}

interface ConnectAction {
  ownerKind: TriggerOwnerKind
  ownerId: string
  workflowTargetId: string
}

/**
 * What a connection means, if anything — pure, so the pairing rule (trigger
 * → target, nothing else) is easy to reason about apart from the store call
 * it triggers.
 */
function resolveConnectAction(connection: Connection): ConnectAction | null {
  const source = parseNodeId(connection.source)
  const target = parseNodeId(connection.target)
  if (source.kind !== 'mapping' && source.kind !== 'schedule') return null
  if (target.kind !== 'target') return null
  return { ownerKind: source.kind, ownerId: source.value, workflowTargetId: target.value }
}

/** Drawing a connection to a target wires it — the target itself is unchanged (and already selectable to configure). */
async function onConnect(connection: Connection): Promise<void> {
  const resolved = resolveConnectAction(connection)
  if (!resolved) return

  const owner =
    resolved.ownerKind === 'mapping'
      ? { mappingId: resolved.ownerId }
      : { scheduleId: resolved.ownerId }
  const created = await triggerActionsStore.create({
    ...owner,
    workflowTargetId: resolved.workflowTargetId,
  })
  if (created) selectedNodeId.value = targetNodeId(resolved.workflowTargetId)
}

/** A drop event's page position, translated into flow coordinates (accounting for the pane's own offset). */
function dropPosition(event: DragEvent): NodePosition {
  const bounds = vueFlowRef.value?.getBoundingClientRect() ?? { left: 0, top: 0 }
  return project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
}

/** Dropping a library card always places a brand new instance — the library never empties, so the same scene/device can be dropped again for a second, independently-configured node. */
async function onLibraryDrop(event: DragEvent): Promise<void> {
  const payload = readLibraryDragPayload(event)
  if (!payload) return
  const created = await workflowTargetsStore.create({
    targetType: payload.kind === 'scene' ? 'scene.execute' : 'device.command',
    targetId: payload.id,
    position: dropPosition(event),
  })
  if (created) recordRecentLibraryItem(payload)
  selectNodeIfCreated(created, targetNodeId)
}

// ── right-click context menu: delete / duplicate / unwire ─────────────────

/** Deletes any node kind — same effect as its inspector's own trash button, callable from the context menu without a node being selected first. */
async function deleteNode(nodeId: string): Promise<void> {
  const { kind, value } = parseNodeId(nodeId)
  if (kind === 'mapping') await mappingsStore.remove(value)
  else if (kind === 'schedule') await schedulesStore.remove(value)
  else if (kind === 'target') {
    await workflowTargetsStore.remove(value)
    triggerActionsStore.removeByWorkflowTargetId(value)
  }
  if (selectedNodeId.value === nodeId) clearSelection()
}

/** Removes every wire touching a node (its outgoing wires for a trigger, incoming for a target) without deleting the node itself. */
async function unwireNode(nodeId: string): Promise<void> {
  const { kind, value } = parseNodeId(nodeId)
  const toRemove = triggerActionsStore.records.filter((action) => {
    if (kind === 'mapping') return action.mappingId === value
    if (kind === 'schedule') return action.scheduleId === value
    if (kind === 'target') return action.workflowTargetId === value
    return false
  })
  await Promise.all(toRemove.map((action) => triggerActionsStore.remove(action.id)))
}

const DUPLICATE_OFFSET: NodePosition = { x: 48, y: 48 }

/** Per-kind duplicator, keyed the same way `parseNodeId` tags a node id — mirrors `POSITION_UPDATERS` above. Each copies the source row's own fields into a brand-new, unwired instance (wires are per-instance, so duplicating never carries them along) and selects it once created. */
const DUPLICATORS: Record<string, (id: string, position: NodePosition) => Promise<void>> = {
  async mapping(id, position) {
    const original = mappingsStore.records.find((m) => m.id === id)
    if (!original) return
    selectNodeIfCreated(
      await mappingsStore.create({
        name: `${original.name} copy`,
        protocol: original.protocol,
        pattern: original.pattern,
        enabled: original.enabled,
        position,
      }),
      mappingNodeId,
    )
  },
  async schedule(id, position) {
    const original = schedulesStore.records.find((s) => s.id === id)
    if (!original) return
    selectNodeIfCreated(
      await schedulesStore.create({
        name: `${original.name} copy`,
        cron: original.cron,
        timezone: original.timezone,
        enabled: original.enabled,
        position,
      }),
      scheduleNodeId,
    )
  },
  async target(id, position) {
    const original = workflowTargetsStore.records.find((t) => t.id === id)
    if (!original) return
    selectNodeIfCreated(
      await workflowTargetsStore.create({
        targetType: original.targetType,
        targetId: original.targetId,
        targetCommand: original.targetCommand,
        params: { ...original.params },
        position,
      }),
      targetNodeId,
    )
  },
}

/** Places a duplicate just below the original's current position. */
async function duplicateNode(nodeId: string): Promise<void> {
  const source = nodes.value.find((n) => n.id === nodeId)
  if (!source) return
  const position: NodePosition = { x: source.position.x + DUPLICATE_OFFSET.x, y: source.position.y + DUPLICATE_OFFSET.y }
  const { kind, value } = parseNodeId(nodeId)
  await DUPLICATORS[kind]?.(value, position)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <p class="text-sm font-semibold">Workflow</p>
      <Button size="sm" @click="saveWorkflow">Save workflow</Button>
    </div>

    <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
      <div class="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span class="flex items-center gap-1.5"><span class="size-2 rounded-sm bg-emerald-500" /> Ingress</span>
        <span class="flex items-center gap-1.5"><span class="bg-brand size-2 rounded-sm" /> CRON</span>
        <span class="flex items-center gap-1.5"><span class="size-2 rounded-sm bg-violet-500" /> Command</span>
        <span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-amber-500" /> Scene</span>
        <Badge v-if="unfinishedCount > 0" variant="warning" class="ml-1">
          <span class="bg-amber-600 inline-block size-1.5 rounded-full dark:bg-amber-400" />
          {{ unfinishedCount }} unfinished
        </Badge>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="createTrigger('schedule')">
          <PlusIcon class="size-4" />
          New schedule
        </Button>
        <Button variant="outline" size="sm" @click="createTrigger('mapping')">
          <PlusIcon class="size-4" />
          New mapping
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <aside class="w-64 shrink-0 overflow-y-auto border-r p-3">
        <LibraryPanel :scenes="scenesStore.records" :devices="devicesStore.records" :rooms="roomsStore.records" />
      </aside>

      <div class="min-w-0 flex-1" @dragover.prevent @drop="onLibraryDrop">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :delete-key-code="null"
          :selection-key-code="['Meta', 'Control']"
          :min-zoom="0.25"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
          @connect="onConnect"
          @edge-mouse-enter="onEdgeMouseEnter"
          @edge-mouse-leave="onEdgeMouseLeave"
          @pane-click="clearSelection"
        >
          <Background :gap="20" />
          <Controls :show-interactive="false" />
          <template #node-trigger="nodeProps">
            <NodeContextMenu :node-id="nodeProps.id" :on-duplicate="duplicateNode" :on-unwire="unwireNode" :on-delete="deleteNode">
              <TriggerNode :data="nodeProps.data" :selected="nodeProps.selected" :connected="hasOutgoingWire(nodeProps.id)" />
            </NodeContextMenu>
          </template>
          <template #node-target="nodeProps">
            <NodeContextMenu :node-id="nodeProps.id" :on-duplicate="duplicateNode" :on-unwire="unwireNode" :on-delete="deleteNode">
              <TargetNode :data="nodeProps.data" :selected="nodeProps.selected" />
            </NodeContextMenu>
          </template>
          <template #edge-trigger-action="props">
            <TriggerActionEdge
              :id="props.id"
              :source-x="props.sourceX"
              :source-y="props.sourceY"
              :target-x="props.targetX"
              :target-y="props.targetY"
              :source-position="props.sourcePosition"
              :target-position="props.targetPosition"
              :marker-end="props.markerEnd"
              :data="props.data"
              :selected="props.selected"
              :hovered="hoveredEdgeId === props.id"
            />
          </template>
        </VueFlow>
      </div>

      <!-- Inspector: the canvas replacement for the old Mapping/Schedule/target dialogs. -->
      <aside v-if="selection" class="w-96 shrink-0 overflow-y-auto border-l p-3">
        <TriggerInspector
          v-if="selection.kind === 'trigger'"
          ref="triggerInspectorRef"
          :key="selectedNodeId ?? undefined"
          :data="selection.data"
          @remove="clearSelection"
          @close="clearSelection"
        />
        <WorkflowTargetInspector
          v-else
          ref="targetInspectorRef"
          :key="selectedNodeId ?? undefined"
          :target="selection.data.target"
          :available-args="selection.data.availableArgs"
          :has-signal-wire="selection.data.hasSignalWire"
          @remove="clearSelection"
          @close="clearSelection"
        />
      </aside>
    </div>
  </div>
</template>

<style>
.vue-flow__controls-button {
  background-color: var(--card);
  border: 1px solid var(--border);

  svg {
    fill: var(--foreground);
  }
}
</style>
