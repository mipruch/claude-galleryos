<script setup lang="ts">
/**
 * The scene editor — one merged, near-fullscreen interface for creating and
 * editing scenes, replacing the old split between a metadata-only modal
 * (`/admin/scenes`) and a separate full-page action canvas
 * (`/admin/workflows/scenes/:id`). Opened from anywhere via `useSceneEditor`
 * (the admin scenes list's New/Edit buttons, a workflow target's "Edit scene
 * steps" button) and mounted once in `AdminLayout`, so it always renders as a
 * dialog over whichever admin page is underneath — including the workflows
 * routing map.
 *
 * Metadata (name, room, look, tags, favourite) is a vee-validate + Zod form,
 * same as the old modal. The action list is a stage board (`SceneStageBoard`)
 * instead of a flat/canvas list: stages are edited as an array-of-arrays
 * (`lib/sceneStages.ts`) so drag-and-drop between columns directly is the
 * `parallelGroup` edit — no coordinate math to reconcile on save.
 */
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { FlaskConicalIcon, SaveIcon, XIcon } from '@lucide/vue'
import type { SceneCreateInput } from '@gallery/types'
import { useSceneEditor } from '@/composables/useSceneEditor'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import { emptyAction, isActionComplete, toActionInput, toEditAction } from '@/lib/sceneActions'
import {
  estimateRunTimeMs,
  flattenStages,
  groupIntoStages,
  incompleteStepCount,
  nonEmptyStageCount,
  totalSteps,
  type SceneStage,
} from '@/lib/sceneStages'
import { sceneIcon } from '@/lib/scenes'
import { DEFAULT_PALETTE_COLOR } from '@/lib/palette'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import SceneEditorSidebar from './SceneEditorSidebar.vue'
import SceneStageBoard from './SceneStageBoard.vue'
import SceneStepInspector from './SceneStepInspector.vue'

const { open, sceneId, close } = useSceneEditor()
const store = useScenesStore()
const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()
const { paramsSchemaFor } = useDeviceCommands()

const isEdit = computed(() => !!sceneId.value)
const stages = ref<SceneStage[]>([[]])
const selectedKey = ref<string | null>(null)
const loadingActions = ref(false)
const testRunning = ref(false)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    roomId: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    tags: z.array(z.string()).optional(),
    isFavorite: z.boolean(),
  }),
)

const { handleSubmit, resetForm, isSubmitting, values } = useForm({ validationSchema })

async function hydrate(): Promise<void> {
  const id = sceneId.value
  const existing = id ? store.records.find((s) => s.id === id) : null
  resetForm({
    values: {
      name: existing?.name ?? '',
      roomId: existing?.roomId ?? '',
      description: existing?.description ?? '',
      icon: existing?.icon ?? '',
      color: existing?.color ?? DEFAULT_PALETTE_COLOR,
      tags: existing?.tags ?? [],
      isFavorite: existing?.isFavorite ?? false,
    },
  })
  stages.value = [[]]
  selectedKey.value = null
  if (id) {
    loadingActions.value = true
    const full = await store.getOne(id)
    stages.value = groupIntoStages((full?.actions ?? []).map(toEditAction))
    loadingActions.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  drivers.load()
  connections.init()
  devices.init()
  store.fetchAll()
  void hydrate()
})

// ── stage board actions ─────────────────────────────────────────────────

function addStage(): void {
  stages.value.push([])
}

function addStep(stageIndex: number): void {
  const action = emptyAction()
  stages.value[stageIndex]?.push(action)
  selectedKey.value = action.key
}

function locateSelected(): { stageIndex: number; index: number } | null {
  for (let stageIndex = 0; stageIndex < stages.value.length; stageIndex++) {
    const index = stages.value[stageIndex]!.findIndex((a) => a.key === selectedKey.value)
    if (index !== -1) return { stageIndex, index }
  }
  return null
}

const selection = computed(() => {
  const location = locateSelected()
  if (!location) return null
  return { ...location, action: stages.value[location.stageIndex]![location.index]! }
})

function removeSelected(): void {
  const location = locateSelected()
  if (!location) return
  stages.value[location.stageIndex]!.splice(location.index, 1)
  selectedKey.value = null
}

// ── header / footer summaries ───────────────────────────────────────────

const roomName = computed(() => devices.rooms.find((r) => r.id === values.roomId)?.name)
const subtitle = computed(() => {
  const steps = totalSteps(stages.value)
  const stageCount = nonEmptyStageCount(stages.value)
  const stepsPart = `${steps} step${steps === 1 ? '' : 's'} in ${stageCount} stage${stageCount === 1 ? '' : 's'}`
  return roomName.value ? `${roomName.value} · ${stepsPart}` : stepsPart
})
const previewIcon = computed(() => sceneIcon(values.icon))
const previewColor = computed(() => values.color || DEFAULT_PALETTE_COLOR)
const incompleteCount = computed(() => incompleteStepCount(stages.value, isActionComplete))
const estimateSeconds = computed(() => (estimateRunTimeMs(stages.value) / 1000).toFixed(1))

// ── save / test run ─────────────────────────────────────────────────────

const submit = handleSubmit(async (formValues) => {
  const flattened = flattenStages(stages.value).filter(({ action }) => isActionComplete(action))
  const builtActions = flattened.map(({ action, parallelGroup }, index) => ({
    ...toActionInput(action, index, paramsSchemaFor(action.deviceId, action.command)),
    parallelGroup,
  }))

  const payload: SceneCreateInput = {
    name: formValues.name,
    roomId: formValues.roomId ? formValues.roomId : null,
    description: formValues.description || undefined,
    icon: formValues.icon || undefined,
    color: formValues.color || undefined,
    tags: formValues.tags?.length ? formValues.tags : undefined,
    isFavorite: formValues.isFavorite,
    actions: builtActions,
  }

  const ok = sceneId.value ? await store.update(sceneId.value, payload) : !!(await store.create(payload))
  if (ok) close()
})

async function testRun(): Promise<void> {
  if (!sceneId.value) return
  testRunning.value = true
  try {
    await api.scenes.dryRun(sceneId.value)
    toast.success('Test run passed', { description: 'The scene plan validated without touching hardware.' })
  } catch (err) {
    toast.error('Test run failed', { description: errMsg(err) })
  } finally {
    testRunning.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(next) => !next && close()">
    <DialogContent
      hide-close
      class="flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[1600px] translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1600px]"
    >
      <DialogDescription class="sr-only">Create or edit a scene's metadata and its ordered actions.</DialogDescription>

      <form class="flex h-full min-h-0 flex-col" @submit="submit">
        <div class="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
          <div class="flex min-w-0 items-center gap-3">
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-lg"
              :style="{ backgroundColor: `${previewColor}1a`, color: previewColor }"
            >
              <component :is="previewIcon" class="size-5" />
            </div>
            <div class="min-w-0">
              <DialogTitle class="truncate text-base leading-tight font-semibold">
                {{ values.name || 'New scene' }}
              </DialogTitle>
              <p class="text-muted-foreground truncate text-xs">{{ subtitle }}</p>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" :disabled="!isEdit || testRunning" @click="testRun">
              <FlaskConicalIcon class="size-4" />
              {{ testRunning ? 'Testing…' : 'Test run' }}
            </Button>
            <Button type="submit" size="sm" class="bg-brand text-brand-foreground hover:bg-brand/90" :disabled="isSubmitting">
              <SaveIcon class="size-4" />
              {{ isSubmitting ? 'Saving…' : 'Save scene' }}
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" @click="close">
              <XIcon class="size-4" />
            </Button>
          </div>
        </div>

        <div class="flex min-h-0 flex-1">
          <aside class="w-72 shrink-0 overflow-y-auto border-r p-5">
            <SceneEditorSidebar />
          </aside>

          <div class="min-w-0 flex-1 overflow-hidden">
            <p v-if="loadingActions" class="text-muted-foreground p-6 text-sm">Loading actions…</p>
            <SceneStageBoard
              v-else
              v-model="stages"
              v-model:selected-key="selectedKey"
              @add-stage="addStage"
              @add-step="addStep"
            />
          </div>

          <aside v-if="selection" class="w-96 shrink-0 overflow-y-auto border-l p-5">
            <SceneStepInspector
              :action="selection.action"
              :stage-number="selection.stageIndex + 1"
              :card-number="selection.index + 1"
              :exclude-scene-id="sceneId ?? undefined"
              @remove="removeSelected"
              @close="selectedKey = null"
            />
          </aside>
          <aside v-else class="text-muted-foreground flex w-96 shrink-0 items-center justify-center border-l p-5 text-center text-sm">
            Select a step to edit it.
          </aside>
        </div>

        <div class="text-muted-foreground flex shrink-0 items-center justify-between border-t px-6 py-3 text-xs">
          <span v-if="incompleteCount" class="flex items-center gap-1.5">
            <span class="bg-amber-500 size-1.5 rounded-full" />
            {{ incompleteCount }} card{{ incompleteCount === 1 ? '' : 's' }} still
            {{ incompleteCount === 1 ? 'needs' : 'need' }} a command
          </span>
          <span v-else />
          <span>Estimated run time {{ estimateSeconds }}s</span>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
