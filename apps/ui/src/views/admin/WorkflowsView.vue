<script setup lang="ts">
/**
 * Workflow routing map — a 3-tier spatial view over the mappings/schedules the
 * admin manages, the `trigger_actions` wired to them, and the scenes/devices
 * those actions resolve to. Every node projects an existing row; the canvas
 * adds nothing to the execution model beyond `position`
 * (see `packages/types/src/canvas.ts`).
 *
 * Creation, wiring, editing and deletion all happen here — this is now the
 * only place a trigger/action gets its target fields set (the old
 * MappingFormDialog/ScheduleFormDialog are gone; the Mappings/Schedules admin
 * list pages route "New"/"Edit" here, the latter via `?select=<nodeId>`). A
 * trigger or action with nothing wired yet is a normal, valid, savable state
 * rendered dashed rather than hidden.
 *
 * Wiring: dragging a connection from a trigger straight to a target
 * auto-creates a new trigger action (so "N wires out of one trigger" is N drag
 * gestures, matching the mental model of routing one schedule to several
 * scenes); dragging from an existing action node to a target just rewires
 * that one action. The "+" under a trigger creates a bare, unwired action and
 * selects it so the inspector opens for picking a target by hand instead.
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
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import {
  actionNodeId,
  buildRoutingGraph,
  mappingNodeId,
  parseAddActionValue,
  parseNodeId,
  scheduleNodeId,
  type RoutingNodeData,
  type RoutingNode,
  type TriggerOwnerKind,
} from '@/lib/workflowGraph'
import { Button } from '@/components/ui/button'
import TriggerNode from '@/components/admin/workflow/TriggerNode.vue'
import TargetNode from '@/components/admin/workflow/TargetNode.vue'
import TriggerActionNode from '@/components/admin/workflow/TriggerActionNode.vue'
import AddNode from '@/components/admin/workflow/AddNode.vue'
import TriggerInspector from '@/components/admin/workflow/TriggerInspector.vue'
import TriggerActionInspector from '@/components/admin/workflow/TriggerActionInspector.vue'

const router = useRouter()
const route = useRoute()
const mappingsStore = useMappingsStore()
const schedulesStore = useSchedulesStore()
const triggerActionsStore = useTriggerActionsStore()
const scenesStore = useScenesStore()
const devicesStore = useDevicesStore()
const { fitView } = useVueFlow()
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
  if (typeof select === 'string') selectedId.value = select
})

const graph = computed(() =>
  buildRoutingGraph({
    mappings: mappingsStore.records,
    schedules: schedulesStore.records,
    triggerActions: triggerActionsStore.records,
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

// ── selection → right-sidebar inspector (hidden when nothing is selected) ──

/** Which inspector (if any) the current selection drives — a single source of truth for the template. */
type Selection =
  | { kind: 'trigger'; data: Extract<RoutingNodeData, { kind: 'mapping' | 'schedule' }> }
  | { kind: 'action'; action: Extract<RoutingNodeData, { kind: 'action' }>['action'] }

const selectedId = ref<string | null>(null)
const selection = computed<Selection | null>(() => {
  const data = nodes.value.find((n) => n.id === selectedId.value)?.data
  if (!data) return null
  if (data.kind === 'mapping' || data.kind === 'schedule') return { kind: 'trigger', data }
  if (data.kind === 'action') return { kind: 'action', action: data.action }
  return null
})

function clearSelection(): void {
  selectedId.value = null
}

/** Select a just-created row's node so its inspector opens — a no-op if creation failed. */
function selectIfCreated<T extends { id: string }>(created: T | null, toNodeId: (id: string) => string): void {
  if (created) selectedId.value = toNodeId(created.id)
}

// ── canvas interactions ────────────────────────────────────────────────────

/** Toolbar "+": a bare, unwired trigger — selected immediately so the inspector opens for naming it. */
async function createTrigger(kind: TriggerOwnerKind): Promise<void> {
  if (kind === 'mapping') {
    selectIfCreated(
      await mappingsStore.create({ name: 'New mapping', protocol: 'osc', pattern: '/', enabled: true }),
      mappingNodeId,
    )
    return
  }
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  selectIfCreated(
    await schedulesStore.create({ name: 'New schedule', cron: '0 8 * * *', timezone: browserTz, enabled: true }),
    scheduleNodeId,
  )
}

/** The "+" under a trigger: a bare, unwired action — selected immediately for picking its target. */
async function createAction(ownerKind: TriggerOwnerKind, ownerId: string): Promise<void> {
  const owner = ownerKind === 'mapping' ? { mappingId: ownerId } : { scheduleId: ownerId }
  selectIfCreated(await triggerActionsStore.create({ ...owner, targetType: 'scene.execute' }), actionNodeId)
}

function onNodeClick({ node }: NodeMouseEvent): void {
  const { kind, value } = parseNodeId(node.id)
  if (kind === 'mapping' || kind === 'schedule' || kind === 'action') {
    selectedId.value = node.id
  } else if (kind === 'scene') {
    router.push({ name: 'admin-workflow-scene', params: { id: value } })
  } else if (kind === 'add-action') {
    const { ownerKind, ownerId } = parseAddActionValue(value)
    void createAction(ownerKind, ownerId)
  }
}

/** Persist a dragged trigger's or action's position. Scene/device nodes auto-layout, so their drag is session-only. */
function onNodeDragStop({ node }: NodeDragEvent): void {
  const { kind, value } = parseNodeId(node.id)
  const position = { x: node.position.x, y: node.position.y }
  if (kind === 'mapping') void mappingsStore.update(value, { position })
  else if (kind === 'schedule') void schedulesStore.update(value, { position })
  else if (kind === 'action') void triggerActionsStore.update(value, { position })
}

type ConnectAction =
  | { kind: 'trigger-to-scene'; ownerKind: TriggerOwnerKind; ownerId: string; sceneId: string }
  | { kind: 'trigger-to-device'; ownerKind: TriggerOwnerKind; ownerId: string; deviceId: string }
  | { kind: 'action-to-scene'; actionId: string; sceneId: string }
  | { kind: 'action-to-device'; actionId: string; deviceId: string }

/**
 * What a connection means, if anything — pure, so the pairing rules are easy
 * to reason about apart from the store calls they trigger.
 */
function resolveConnectAction(connection: Connection): ConnectAction | null {
  const source = parseNodeId(connection.source)
  const target = parseNodeId(connection.target)
  const isTrigger = source.kind === 'mapping' || source.kind === 'schedule'

  if (isTrigger && target.kind === 'scene') {
    return { kind: 'trigger-to-scene', ownerKind: source.kind as TriggerOwnerKind, ownerId: source.value, sceneId: target.value }
  }
  if (isTrigger && target.kind === 'device') {
    return { kind: 'trigger-to-device', ownerKind: source.kind as TriggerOwnerKind, ownerId: source.value, deviceId: target.value }
  }
  if (source.kind === 'action' && target.kind === 'scene') {
    return { kind: 'action-to-scene', actionId: source.value, sceneId: target.value }
  }
  if (source.kind === 'action' && target.kind === 'device') {
    return { kind: 'action-to-device', actionId: source.value, deviceId: target.value }
  }
  // Any other pairing (e.g. a scene dropped on a device) isn't a shape the server accepts.
  return null
}

/** Drawing a connection creates or rewires a trigger action — the same mutation the inspector makes by hand. */
async function onConnect(connection: Connection): Promise<void> {
  const resolved = resolveConnectAction(connection)
  if (!resolved) return

  if (resolved.kind === 'trigger-to-scene' || resolved.kind === 'trigger-to-device') {
    const owner = resolved.ownerKind === 'mapping' ? { mappingId: resolved.ownerId } : { scheduleId: resolved.ownerId }
    const created = await triggerActionsStore.create({
      ...owner,
      targetType: resolved.kind === 'trigger-to-scene' ? 'scene.execute' : 'device.command',
      targetId: resolved.kind === 'trigger-to-scene' ? resolved.sceneId : resolved.deviceId,
    })
    selectIfCreated(created, actionNodeId)
  } else if (resolved.kind === 'action-to-scene') {
    await triggerActionsStore.update(resolved.actionId, {
      targetType: 'scene.execute',
      targetId: resolved.sceneId,
      targetCommand: null,
    })
    selectedId.value = actionNodeId(resolved.actionId)
  } else if (resolved.kind === 'action-to-device') {
    await triggerActionsStore.update(resolved.actionId, { targetType: 'device.command', targetId: resolved.deviceId })
    selectedId.value = actionNodeId(resolved.actionId)
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
      <div class="min-w-0 flex-1">
        <VueFlow
          :nodes="nodes"
          :edges="edges"
          :delete-key-code="null"
          :min-zoom="0.25"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
          @connect="onConnect"
          @pane-click="clearSelection"
        >
          <Background :gap="20" />
          <Controls :show-interactive="false" />
          <template #node-trigger="props">
            <TriggerNode :data="props.data" :selected="props.selected" />
          </template>
          <template #node-action="props">
            <TriggerActionNode :data="props.data" :selected="props.selected" />
          </template>
          <template #node-target="props">
            <TargetNode :data="props.data" :selected="props.selected" />
          </template>
          <template #node-add="props">
            <AddNode :data="props.data" />
          </template>
        </VueFlow>
      </div>

      <!-- Inspector: the canvas replacement for the old Mapping/Schedule/target dialogs. -->
      <aside v-if="selection" class="w-96 shrink-0 overflow-y-auto border-l p-3">
        <TriggerInspector v-if="selection.kind === 'trigger'" :key="selectedId ?? undefined" :data="selection.data" @remove="clearSelection" />
        <TriggerActionInspector v-else :key="selectedId ?? undefined" :action="selection.action" @remove="clearSelection" />
      </aside>
    </div>
  </div>
</template>
