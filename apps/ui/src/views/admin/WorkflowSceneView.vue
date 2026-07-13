<script setup lang="ts">
/**
 * A scene's action graph — the drill-down target from a scene node on the
 * routing map (`WorkflowsView`). Actions are laid out as stage columns (one
 * per `parallelGroup`); dragging a node across columns re-groups it, dragging
 * within a column reorders it. Nothing auto-saves: an in-progress action
 * (missing its device+command, or its sub-scene) would fail the server's
 * validation for the *whole* scene if a partial state slipped out on a stray
 * drag, so every change here — position, grouping, or field edits made in the
 * inspector — waits for an explicit Save, like the flat scene editor already
 * batches metadata + actions into one submit.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  VueFlow,
  useNodesInitialized,
  useVueFlow,
  type NodeDragEvent,
  type NodeMouseEvent,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { ArrowLeftIcon, PlusIcon, SaveIcon } from '@lucide/vue'
import type { SceneWithActionsDTO } from '@gallery/types'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import {
  emptyAction,
  isActionComplete,
  toActionInput,
  toEditAction,
  type EditAction,
} from '@/lib/sceneActions'
import {
  buildSceneStageGraph,
  columnIndexFromX,
  distinctGroups,
  orderActionsForSave,
  parseNodeId,
} from '@/lib/workflowGraph'
import { Button } from '@/components/ui/button'
import SceneActionRow from '@/components/admin/SceneActionRow.vue'
import StageNode from '@/components/admin/workflow/StageNode.vue'
import ActionNode from '@/components/admin/workflow/ActionNode.vue'

const route = useRoute()
const router = useRouter()
const scenesStore = useScenesStore()
const devicesStore = useDevicesStore()
const { paramsSchemaFor } = useDeviceCommands()

const sceneId = computed(() => route.params.id as string)
const scene = ref<SceneWithActionsDTO | null>(null)
const actions = ref<EditAction[]>([])
const loading = ref(false)
const saving = ref(false)
const selectedKey = ref<string | null>(null)
const { fitView } = useVueFlow()
const nodesInitialized = useNodesInitialized()

async function load(): Promise<void> {
  loading.value = true
  selectedKey.value = null
  devicesStore.fetchAll()
  scenesStore.fetchAll()
  scene.value = await scenesStore.getOne(sceneId.value)
  actions.value = (scene.value?.actions ?? []).map(toEditAction)
  loading.value = false
}
onMounted(load)
watch(sceneId, load)

// <VueFlow>'s own mount (and its fit-view-on-init) happens before `load()`
// resolves and before Vue Flow has measured the real nodes' bounds
// (`useNodesInitialized` stays false until it has), so it locks onto a
// near-empty first render. Fit once the current node set is actually measured.
watch(nodesInitialized, (ready) => {
  if (ready) void fitView()
})

const graph = computed(() => buildSceneStageGraph(actions.value))
const nodes = computed(() => graph.value.nodes)

const selectedAction = computed(() => actions.value.find((a) => a.key === selectedKey.value) ?? null)
const selectedIndex = computed(() => actions.value.findIndex((a) => a.key === selectedKey.value))

function onNodeClick({ node }: NodeMouseEvent): void {
  const { kind, value } = parseNodeId(node.id)
  if (kind === 'action') selectedKey.value = value
}

/** Dragging across columns re-groups into that column's *existing* group value (not its rank), so it truly merges rather than spawning a new column. */
function onNodeDragStop({ node }: NodeDragEvent): void {
  const { kind, value } = parseNodeId(node.id)
  if (kind !== 'action') return
  const action = actions.value.find((a) => a.key === value)
  if (!action) return
  const groups = distinctGroups(actions.value)
  const targetGroup = groups[columnIndexFromX(node.position.x, groups.length)] ?? 0
  action.parallelGroup = String(targetGroup)
  action.position = { x: node.position.x, y: node.position.y }
}

function addAction(): void {
  const groups = distinctGroups(actions.value)
  const action = emptyAction()
  action.parallelGroup = String(groups.length ? Math.max(...groups) + 1 : 0)
  actions.value.push(action)
  selectedKey.value = action.key
}

function removeSelected(): void {
  const i = actions.value.findIndex((a) => a.key === selectedKey.value)
  if (i === -1) return
  actions.value.splice(i, 1)
  selectedKey.value = null
}

/** SceneActionRow's reorder buttons still work (plain array move) but only affect the stepOrder tiebreak — column/position (not array order) drive the visual layout here. */
function moveSelected(delta: number): void {
  const i = actions.value.findIndex((a) => a.key === selectedKey.value)
  if (i === -1) return
  const j = i + delta
  if (j < 0 || j >= actions.value.length) return
  const [item] = actions.value.splice(i, 1)
  if (item) actions.value.splice(j, 0, item)
}

async function save(): Promise<void> {
  if (!scene.value) return
  const incomplete = actions.value.find((a) => !isActionComplete(a))
  if (incomplete) {
    toast.warning('Finish editing before saving', {
      description: 'Every action needs a device + command, or a sub-scene to run.',
    })
    return
  }

  // Renumber parallelGroup to its rank (0, 1, 2, …) so a merged/emptied
  // column never leaves a gap in what's persisted; stepOrder follows the same
  // order the canvas shows (group rank, then on-canvas y).
  const rankOf = new Map(distinctGroups(actions.value).map((raw, index) => [raw, index]))
  const ordered = orderActionsForSave(actions.value)

  saving.value = true
  const built = ordered.map((a, i) => ({
    ...toActionInput(a, i, paramsSchemaFor(a.deviceId, a.command)),
    parallelGroup: rankOf.get(Number(a.parallelGroup) || 0) ?? 0,
  }))
  const ok = await scenesStore.update(sceneId.value, { actions: built })
  saving.value = false
  if (ok) await load()
}
</script>

<template>
  <div v-if="scene" class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to routing map" @click="router.push({ name: 'admin-workflows' })">
          <ArrowLeftIcon class="size-4" />
        </Button>
        <div class="min-w-0">
          <p class="truncate font-medium">{{ scene.name }}</p>
          <p class="text-muted-foreground text-xs">{{ actions.length }} action{{ actions.length === 1 ? '' : 's' }}</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="addAction">
          <PlusIcon class="size-4" />
          Add action
        </Button>
        <Button size="sm" :disabled="saving" @click="save">
          <SaveIcon class="size-4" />
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <div class="min-w-0 flex-1">
        <VueFlow
          :nodes="nodes"
          :edges="[]"
          :delete-key-code="null"
          :nodes-connectable="false"
          :min-zoom="0.25"
          @node-click="onNodeClick"
          @node-drag-stop="onNodeDragStop"
        >
          <Background :gap="20" />
          <Controls :show-interactive="false" />
          <template #node-stage="props">
            <StageNode :data="props.data" />
          </template>
          <template #node-action="props">
            <ActionNode :data="props.data" :selected="props.selected" />
          </template>
        </VueFlow>
      </div>

      <!-- Inspector: the full SceneActionRow editor for whichever action node is selected. -->
      <aside v-if="selectedAction" class="w-96 shrink-0 overflow-y-auto border-l p-3">
        <SceneActionRow
          :action="selectedAction"
          :index="selectedIndex"
          :total="actions.length"
          :exclude-scene-id="scene.id"
          @remove="removeSelected"
          @move-up="moveSelected(-1)"
          @move-down="moveSelected(1)"
        />
      </aside>
    </div>
  </div>

  <div v-else-if="!loading" class="flex h-full flex-col items-center justify-center gap-3 text-center">
    <p class="text-muted-foreground text-sm">Scene not found.</p>
    <Button variant="outline" size="sm" @click="router.push({ name: 'admin-workflows' })">Back to routing map</Button>
  </div>

  <p v-else class="text-muted-foreground p-6 text-sm">Loading scene…</p>
</template>
