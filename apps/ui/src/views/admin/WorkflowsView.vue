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
 * params), so its inspector shows a button into its own action-stage canvas
 * (`WorkflowSceneView`) instead, a separate route reusing the same
 * graph/canvas building blocks at a deeper zoom level.
 */
import { computed, onMounted, ref, watch } from 'vue'
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
import { PlusIcon, WaypointsIcon } from '@lucide/vue'
import { useMappingsStore } from '@/stores/mappings'
import { useSchedulesStore } from '@/stores/schedules'
import { useTriggerActionsStore } from '@/stores/triggerActions'
import { useWorkflowTargetsStore } from '@/stores/workflowTargets'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
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
import { Button } from '@/components/ui/button'
import TriggerNode from '@/components/admin/workflow/TriggerNode.vue'
import TargetNode from '@/components/admin/workflow/TargetNode.vue'
import TriggerActionEdge from '@/components/admin/workflow/TriggerActionEdge.vue'
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
  ])
  // Deep-link from the Mappings/Schedules list pages' Edit action.
  const select = route.query.select
  if (typeof select === 'string') selectedNodeId.value = select
})

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
function selectNodeIfCreated<T extends { id: string }>(created: T | null, toNodeId: (id: string) => string): void {
  if (!created) return
  selectedNodeId.value = toNodeId(created.id)
}

// ── canvas interactions ────────────────────────────────────────────────────

/** Toolbar "+": a bare, unwired trigger — selected immediately so the inspector opens for naming it. */
async function createTrigger(kind: TriggerOwnerKind): Promise<void> {
  if (kind === 'mapping') {
    selectNodeIfCreated(
      await mappingsStore.create({ name: 'New mapping', protocol: 'osc', pattern: '/', enabled: true }),
      mappingNodeId,
    )
    return
  }
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  selectNodeIfCreated(
    await schedulesStore.create({ name: 'New schedule', cron: '0 8 * * *', timezone: browserTz, enabled: true }),
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

/** Persist a dragged trigger's or target's position — every node kind is draggable and now sticks. */
function onNodeDragStop({ node }: NodeDragEvent): void {
  const { kind, value } = parseNodeId(node.id)
  POSITION_UPDATERS[kind]?.(value, { x: node.position.x, y: node.position.y })
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

  const owner = resolved.ownerKind === 'mapping' ? { mappingId: resolved.ownerId } : { scheduleId: resolved.ownerId }
  const created = await triggerActionsStore.create({ ...owner, workflowTargetId: resolved.workflowTargetId })
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
  selectNodeIfCreated(created, targetNodeId)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div class="flex items-center gap-2">
        <WaypointsIcon class="text-muted-foreground size-4" />
        <p class="font-medium">Trigger routing</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="createTrigger('schedule')">
          <PlusIcon class="size-4" />
          New schedule
        </Button>
        <Button size="sm" @click="createTrigger('mapping')">
          <PlusIcon class="size-4" />
          New mapping
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <aside class="w-56 shrink-0 overflow-y-auto border-r p-3">
        <LibraryPanel :scenes="scenesStore.records" :devices="devicesStore.records" />
      </aside>

      <div class="min-w-0 flex-1" @dragover.prevent @drop="onLibraryDrop">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :delete-key-code="null"
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
          <template #node-trigger="props">
            <TriggerNode :data="props.data" :selected="props.selected" />
          </template>
          <template #node-target="props">
            <TargetNode :data="props.data" :selected="props.selected" />
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
        <TriggerInspector v-if="selection.kind === 'trigger'" :key="selectedNodeId ?? undefined" :data="selection.data" @remove="clearSelection" />
        <WorkflowTargetInspector
          v-else
          :key="selectedNodeId ?? undefined"
          :target="selection.data.target"
          :available-args="selection.data.availableArgs"
          :has-signal-wire="selection.data.hasSignalWire"
          @remove="clearSelection"
        />
      </aside>
    </div>
  </div>
</template>
