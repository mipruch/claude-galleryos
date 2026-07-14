<script setup lang="ts">
/**
 * Workflow routing map — a spatial view over the mappings/schedules the admin
 * manages, the scenes/devices they can fire, and the `trigger_actions` wiring
 * one to the other. Every node projects an existing row; the canvas adds
 * nothing to the execution model beyond `position`
 * (see `packages/types/src/canvas.ts`).
 *
 * Creation, wiring, editing and deletion all happen here — this is now the
 * only place a trigger/action gets its target fields set (the old
 * MappingFormDialog/ScheduleFormDialog are gone; the Mappings/Schedules admin
 * list pages route "New"/"Edit" here, the latter via `?select=<nodeId>`).
 *
 * A trigger action has no node of its own: dragging a connection straight
 * from a trigger to a target (scene/device) atomically creates one, and the
 * edge itself — not a separate node — is what you click to open its
 * inspector. A target only appears on the canvas once it's been dragged there
 * from the library panel (left sidebar: every scene/device with no saved
 * position and no trigger action wired to it yet) or some trigger action
 * already resolves to it.
 *
 * Clicking a scene node drills into its own action-stage canvas
 * (`WorkflowSceneView`), a separate route reusing the same graph/canvas
 * building blocks at a deeper zoom level.
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
import type { TriggerActionDTO } from '@gallery/types'
import { useMappingsStore } from '@/stores/mappings'
import { useSchedulesStore } from '@/stores/schedules'
import { useTriggerActionsStore } from '@/stores/triggerActions'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import {
  buildRoutingGraph,
  mappingNodeId,
  parseNodeId,
  scheduleNodeId,
  triggerActionEdgeId,
  unplacedLibraryItems,
  type RoutingNodeData,
  type RoutingNode,
  type RoutingEdge,
  type TriggerOwnerKind,
} from '@/lib/workflowGraph'
import { readLibraryDragPayload } from '@/lib/libraryDrag'
import { Button } from '@/components/ui/button'
import TriggerNode from '@/components/admin/workflow/TriggerNode.vue'
import TargetNode from '@/components/admin/workflow/TargetNode.vue'
import LibraryPanel from '@/components/admin/workflow/LibraryPanel.vue'
import TriggerInspector from '@/components/admin/workflow/TriggerInspector.vue'
import TriggerActionInspector from '@/components/admin/workflow/TriggerActionInspector.vue'

const router = useRouter()
const route = useRoute()
const mappingsStore = useMappingsStore()
const schedulesStore = useSchedulesStore()
const triggerActionsStore = useTriggerActionsStore()
const scenesStore = useScenesStore()
const devicesStore = useDevicesStore()
const { fitView, project, vueFlowRef } = useVueFlow()
const nodesInitialized = useNodesInitialized()

onMounted(async () => {
  await Promise.all([
    mappingsStore.fetchAll(),
    schedulesStore.fetchAll(),
    triggerActionsStore.fetchAll(),
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
  scenes: scenesStore.records,
  devices: devicesStore.records,
}))
const graph = computed(() => buildRoutingGraph(graphInput.value))
const nodes = computed<RoutingNode[]>(() => graph.value.nodes)
const edges = computed<RoutingEdge[]>(() => graph.value.edges)
const library = computed(() => unplacedLibraryItems(graphInput.value))

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
  | { kind: 'action'; action: TriggerActionDTO }

const selectedNodeId = ref<string | null>(null)
const selectedEdgeId = ref<string | null>(null)
const selection = computed<Selection | null>(() => {
  if (selectedEdgeId.value) {
    const found = edges.value.find((e) => e.id === selectedEdgeId.value)
    return found?.data ? { kind: 'action', action: found.data.triggerAction } : null
  }
  const data = nodes.value.find((n) => n.id === selectedNodeId.value)?.data
  if (data?.kind === 'mapping' || data?.kind === 'schedule') return { kind: 'trigger', data }
  return null
})

function clearSelection(): void {
  selectedNodeId.value = null
  selectedEdgeId.value = null
}

/** Select a just-created trigger's node so its inspector opens — a no-op if creation failed. */
function selectNodeIfCreated<T extends { id: string }>(created: T | null, toNodeId: (id: string) => string): void {
  if (!created) return
  selectedEdgeId.value = null
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

function onNodeClick({ node }: NodeMouseEvent): void {
  const { kind, value } = parseNodeId(node.id)
  if (kind === 'mapping' || kind === 'schedule') {
    selectedEdgeId.value = null
    selectedNodeId.value = node.id
  } else if (kind === 'scene') {
    router.push({ name: 'admin-workflow-scene', params: { id: value } })
  }
  // 'device' nodes have nothing to edit directly from a click — only via the
  // trigger-action edges wired to them.
}

function onEdgeClick({ edge }: EdgeMouseEvent): void {
  selectedNodeId.value = null
  selectedEdgeId.value = edge.id
}

type NodePosition = { x: number; y: number }

/** Per-kind position persistence, keyed the same way `parseNodeId` tags a node id. */
const POSITION_UPDATERS: Record<string, (id: string, position: NodePosition) => void> = {
  mapping: (id, position) => void mappingsStore.update(id, { position }),
  schedule: (id, position) => void schedulesStore.update(id, { position }),
  scene: (id, position) => void scenesStore.update(id, { position }),
  device: (id, position) => void devicesStore.updateDevice(id, { position }),
}

/** Persist a dragged trigger's or target's position — every node kind is draggable and now sticks. */
function onNodeDragStop({ node }: NodeDragEvent): void {
  const { kind, value } = parseNodeId(node.id)
  POSITION_UPDATERS[kind]?.(value, { x: node.position.x, y: node.position.y })
}

type ConnectAction =
  | { kind: 'trigger-to-scene'; ownerKind: TriggerOwnerKind; ownerId: string; sceneId: string }
  | { kind: 'trigger-to-device'; ownerKind: TriggerOwnerKind; ownerId: string; deviceId: string }

/**
 * What a connection means, if anything — pure, so the pairing rule (trigger
 * → target, nothing else) is easy to reason about apart from the store call
 * it triggers.
 */
function resolveConnectAction(connection: Connection): ConnectAction | null {
  const source = parseNodeId(connection.source)
  const target = parseNodeId(connection.target)
  if (source.kind !== 'mapping' && source.kind !== 'schedule') return null

  if (target.kind === 'scene') {
    return { kind: 'trigger-to-scene', ownerKind: source.kind, ownerId: source.value, sceneId: target.value }
  }
  if (target.kind === 'device') {
    return { kind: 'trigger-to-device', ownerKind: source.kind, ownerId: source.value, deviceId: target.value }
  }
  // Any other pairing (e.g. two targets, or a target dragged as the source) isn't a shape the server accepts.
  return null
}

/** Drawing a connection straight to a target atomically creates a fully-wired trigger action. */
async function onConnect(connection: Connection): Promise<void> {
  const resolved = resolveConnectAction(connection)
  if (!resolved) return

  const owner = resolved.ownerKind === 'mapping' ? { mappingId: resolved.ownerId } : { scheduleId: resolved.ownerId }
  const created = await triggerActionsStore.create({
    ...owner,
    targetType: resolved.kind === 'trigger-to-scene' ? 'scene.execute' : 'device.command',
    targetId: resolved.kind === 'trigger-to-scene' ? resolved.sceneId : resolved.deviceId,
  })
  if (created) {
    selectedNodeId.value = null
    selectedEdgeId.value = triggerActionEdgeId(created.id)
  }
}

/** A drop event's page position, translated into flow coordinates (accounting for the pane's own offset). */
function dropPosition(event: DragEvent): NodePosition {
  const bounds = vueFlowRef.value?.getBoundingClientRect() ?? { left: 0, top: 0 }
  return project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })
}

/** Dropping a library card gives that scene/device a position, which is what makes it a canvas node. */
function onLibraryDrop(event: DragEvent): void {
  const payload = readLibraryDragPayload(event)
  if (!payload) return
  POSITION_UPDATERS[payload.kind]?.(payload.id, dropPosition(event))
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
        <LibraryPanel :scenes="library.scenes" :devices="library.devices" />
      </aside>

      <div class="min-w-0 flex-1" @dragover.prevent @drop="onLibraryDrop">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :delete-key-code="null"
          :min-zoom="0.25"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
          @edge-click="onEdgeClick"
          @connect="onConnect"
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
        </VueFlow>
      </div>

      <!-- Inspector: the canvas replacement for the old Mapping/Schedule/target dialogs. -->
      <aside v-if="selection" class="w-96 shrink-0 overflow-y-auto border-l p-3">
        <TriggerInspector v-if="selection.kind === 'trigger'" :key="selectedNodeId ?? undefined" :data="selection.data" @remove="clearSelection" />
        <TriggerActionInspector v-else :key="selectedEdgeId ?? undefined" :action="selection.action" @remove="clearSelection" />
      </aside>
    </div>
  </div>
</template>
