<script setup lang="ts">
/**
 * Workflow routing map — a spatial view over the mappings/schedules/scenes/
 * devices the admin already manages elsewhere. Every node is a projection of
 * an existing row; the canvas adds nothing to the execution model beyond
 * `position` (see `packages/types/src/canvas.ts`). Editing a trigger's target
 * by dragging a connection reuses the same store mutations the Mappings/
 * Schedules admin pages already call; editing a trigger's other fields opens
 * the existing `MappingFormDialog`/`ScheduleFormDialog` rather than
 * duplicating their forms here. Double-clicking* a scene node drills into its
 * own action-stage canvas (`WorkflowSceneView`), a separate route reusing the
 * same graph/canvas building blocks at a deeper zoom level.
 *
 * Deleting a mapping/schedule stays on their existing admin list pages — the
 * canvas is for arranging and wiring, not a second CRUD surface.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  VueFlow,
  useNodesInitialized,
  useVueFlow,
  type Connection,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { PlusIcon, WaypointsIcon } from '@lucide/vue'
import type { InputMappingDTO, ScheduledJobDTO } from '@gallery/types'
import { useMappingsStore } from '@/stores/mappings'
import { useSchedulesStore } from '@/stores/schedules'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { buildRoutingGraph, parseNodeId, type RoutingNode } from '@/lib/workflowGraph'
import { Button } from '@/components/ui/button'
import MappingFormDialog from '@/components/admin/MappingFormDialog.vue'
import ScheduleFormDialog from '@/components/admin/ScheduleFormDialog.vue'
import TriggerNode from '@/components/admin/workflow/TriggerNode.vue'
import TargetNode from '@/components/admin/workflow/TargetNode.vue'

const router = useRouter()
const mappingsStore = useMappingsStore()
const schedulesStore = useSchedulesStore()
const scenesStore = useScenesStore()
const devicesStore = useDevicesStore()
const { fitView } = useVueFlow()
const nodesInitialized = useNodesInitialized()

onMounted(() => {
  mappingsStore.fetchAll()
  schedulesStore.fetchAll()
  scenesStore.fetchAll()
  devicesStore.fetchAll()
})

const graph = computed(() =>
  buildRoutingGraph({
    mappings: mappingsStore.records,
    schedules: schedulesStore.records,
    scenes: scenesStore.records,
    devices: devicesStore.records,
  }),
)
const nodes = computed<RoutingNode[]>(() => graph.value.nodes)
const edges = computed(() => graph.value.edges)

// `fit-view-on-init` fits as soon as <VueFlow> mounts — before the fetches
// above resolve and before Vue Flow has measured the real nodes' bounds
// (`useNodesInitialized` stays false until it has), so it locks onto
// whatever the very first, near-empty render happened to be. Fit once the
// current node set is actually measured instead.
watch(nodesInitialized, (ready) => {
  if (ready) void fitView()
})

// ── trigger dialogs (reused as-is, not reimplemented for the canvas) ──────

const mappingDialogOpen = ref(false)
const selectedMapping = ref<InputMappingDTO | null>(null)
function openMappingDialog(mapping: InputMappingDTO | null): void {
  selectedMapping.value = mapping
  mappingDialogOpen.value = true
}

const scheduleDialogOpen = ref(false)
const selectedSchedule = ref<ScheduledJobDTO | null>(null)
function openScheduleDialog(schedule: ScheduledJobDTO | null): void {
  selectedSchedule.value = schedule
  scheduleDialogOpen.value = true
}

// ── canvas interactions ────────────────────────────────────────────────────

function onNodeClick({ node }: NodeMouseEvent): void {
  const { kind, value } = parseNodeId(node.id)
  if (kind === 'mapping') openMappingDialog(mappingsStore.records.find((m) => m.id === value) ?? null)
  else if (kind === 'schedule') openScheduleDialog(schedulesStore.records.find((s) => s.id === value) ?? null)
  else if (kind === 'scene') router.push({ name: 'admin-workflow-scene', params: { id: value } })
}

/** Persist a dragged trigger's position. Scene/device nodes auto-layout, so their drag is session-only. */
function onNodeDragStop({ node }: NodeDragEvent): void {
  const { kind, value } = parseNodeId(node.id)
  const position = { x: node.position.x, y: node.position.y }
  if (kind === 'mapping') void mappingsStore.update(value, { position })
  else if (kind === 'schedule') void schedulesStore.update(value, { position })
}

type ConnectAction =
  | { kind: 'mapping-to-scene'; mappingId: string; sceneId: string }
  | { kind: 'mapping-to-device'; mappingId: string; deviceId: string }
  | { kind: 'schedule-to-scene'; scheduleId: string; sceneId: string }

/**
 * What a connection means, if anything — pure, so the pairing rules (a
 * schedule can only ever target a scene, etc.) are easy to reason about apart
 * from the store calls / dialog-opening they trigger.
 */
function resolveConnectAction(connection: Connection): ConnectAction | null {
  const source = parseNodeId(connection.source)
  const target = parseNodeId(connection.target)
  if (source.kind === 'mapping' && target.kind === 'scene') {
    return { kind: 'mapping-to-scene', mappingId: source.value, sceneId: target.value }
  }
  if (source.kind === 'mapping' && target.kind === 'device') {
    return { kind: 'mapping-to-device', mappingId: source.value, deviceId: target.value }
  }
  if (source.kind === 'schedule' && target.kind === 'scene') {
    return { kind: 'schedule-to-scene', scheduleId: source.value, sceneId: target.value }
  }
  // Any other pairing (e.g. a schedule dropped on a device) isn't a target
  // shape the server accepts.
  return null
}

/** Drawing a connection rewires a trigger's target — the same mutation the Mappings/Schedules forms make. */
function onConnect(connection: Connection): void {
  const action = resolveConnectAction(connection)
  if (!action) return

  if (action.kind === 'mapping-to-scene') {
    void mappingsStore.update(action.mappingId, { targetType: 'scene.execute', targetId: action.sceneId, targetCommand: null })
  } else if (action.kind === 'mapping-to-device') {
    // Which command to run can't be inferred from an edge drop — open the
    // form (pre-filled) so the user picks one, same as editing it by hand.
    const mapping = mappingsStore.records.find((m) => m.id === action.mappingId)
    if (mapping) openMappingDialog({ ...mapping, targetType: 'device.command', targetId: action.deviceId, targetCommand: '' })
  } else if (action.kind === 'schedule-to-scene') {
    void schedulesStore.update(action.scheduleId, { sceneId: action.sceneId })
  }
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
        <Button variant="outline" size="sm" @click="openScheduleDialog(null)">
          <PlusIcon class="size-4" />
          New schedule
        </Button>
        <Button size="sm" @click="openMappingDialog(null)">
          <PlusIcon class="size-4" />
          New mapping
        </Button>
      </div>
    </div>

    <div class="min-h-0 flex-1">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :delete-key-code="null"
        :min-zoom="0.25"
        @node-click="onNodeClick"
        @node-drag-stop="onNodeDragStop"
        @connect="onConnect"
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

    <MappingFormDialog v-model:open="mappingDialogOpen" :mapping="selectedMapping" />
    <ScheduleFormDialog v-model:open="scheduleDialogOpen" :schedule="selectedSchedule" />
  </div>
</template>
