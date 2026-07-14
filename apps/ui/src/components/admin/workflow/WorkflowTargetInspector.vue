<script setup lang="ts">
/**
 * Right-sidebar inspector for a selected workflow-target node — what one
 * placed instance does: a scene run or a device command. `targetType`/
 * `targetId` are fixed at placement (see `packages/types/src/records.ts`'s
 * `WorkflowTargetUpdateInput`) and shown read-only here; to fire something
 * else, delete this instance and drag a new one from the library. A
 * device.command instance's command and params stay editable in place, and —
 * since the same scene/device can be placed any number of times — deleting
 * just this instance never touches any other instance of the same
 * scene/device.
 *
 * Params render as typed widgets resolved from the command's schema (see
 * `WorkflowTargetParamField`). `availableArgs`/`hasSignalWire` come from the
 * node's own graph data (`workflowGraph.ts`'s `addTargetNodes`) — the union of
 * named path-params every incoming mapping-owned wire's pattern captures, and
 * whether any incoming wire is mapping-owned at all (a schedule fire carries
 * no signal, so a target wired only to schedules never shows the toggle).
 *
 * The parent view keys this component on the selected node's id, so a fresh
 * instance mounts per selection and the local `params`/`tokenMode` state
 * never needs re-hydrating mid-lifetime (see `TriggerInspector` for the same
 * pattern).
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ExternalLinkIcon, PlayCircleIcon, SlidersHorizontalIcon, Trash2Icon } from '@lucide/vue'
import type { WorkflowTargetDTO } from '@gallery/types'
import { useWorkflowTargetsStore } from '@/stores/workflowTargets'
import { useTriggerActionsStore } from '@/stores/triggerActions'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import { schemaToFields } from '@/lib/schemaForm'
import { resolveTargetNames, targetSummary, usesParams } from '@/lib/workflowTargets'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import WorkflowTargetParamField from './WorkflowTargetParamField.vue'

const props = defineProps<{ target: WorkflowTargetDTO; availableArgs: string[]; hasSignalWire: boolean }>()
const emit = defineEmits<{ remove: [] }>()

const router = useRouter()
const targetsStore = useWorkflowTargetsStore()
const triggerActionsStore = useTriggerActionsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()
const { commandsFor, paramsSchemaFor } = useDeviceCommands()

const isScene = computed(() => props.target.targetType === 'scene.execute')
const summary = computed(() =>
  targetSummary(props.target.targetType, resolveTargetNames(props.target, scenes.records, devices.records)),
)

const targetCommand = ref(props.target.targetCommand ?? '')
const params = reactive<Record<string, unknown>>({ ...props.target.params })

/** Fields whose stored value already looks like a template token — defaults that field's toggle to "from signal". */
const TOKEN_PATTERN = /\{(?:arg\[\d+\]|:[A-Za-z_][\w-]*)\}/
const tokenMode = reactive<Record<string, boolean>>({})
for (const [key, value] of Object.entries(params)) {
  tokenMode[key] = typeof value === 'string' && TOKEN_PATTERN.test(value)
}

const deviceCommands = computed(() => commandsFor(props.target.targetId))
const paramFields = computed(() => schemaToFields(paramsSchemaFor(props.target.targetId, targetCommand.value)))

// A new command starts with fresh params — the old command's fields may not
// even exist on the new one.
watch(targetCommand, () => {
  for (const key of Object.keys(params)) delete params[key]
  for (const key of Object.keys(tokenMode)) delete tokenMode[key]
})

const saving = ref(false)

async function submit(): Promise<void> {
  saving.value = true
  try {
    await targetsStore.update(props.target.id, {
      targetCommand: targetCommand.value || null,
      params: { ...params },
    })
  } finally {
    saving.value = false
  }
}

function openSceneEditor(): void {
  router.push({ name: 'admin-workflow-scene', params: { id: props.target.targetId } })
}

async function remove(): Promise<void> {
  await targetsStore.remove(props.target.id)
  triggerActionsStore.removeByWorkflowTargetId(props.target.id)
  emit('remove')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium">Action</p>
      <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="remove">
        <Trash2Icon class="size-4" />
      </Button>
    </div>

    <div class="flex items-center gap-2 rounded-md border px-3 py-2">
      <component :is="isScene ? PlayCircleIcon : SlidersHorizontalIcon" class="text-muted-foreground size-4 shrink-0" />
      <p class="text-sm">{{ summary }}</p>
    </div>
    <p class="text-muted-foreground text-xs">To fire something else, delete this instance and drag a new one from the library.</p>

    <Button v-if="isScene" variant="outline" @click="openSceneEditor">
      <ExternalLinkIcon class="size-4" />
      Edit scene steps
    </Button>

    <template v-if="usesParams(target.targetType)">
      <div class="space-y-1.5">
        <Label class="text-xs">Command</Label>
        <Select v-model="targetCommand">
          <SelectTrigger><SelectValue placeholder="Pick a command…" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="c in deviceCommands" :key="c.command" :value="c.command">{{ c.command }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <p v-if="availableArgs.length" class="text-muted-foreground text-xs">
        Available from signal: <span class="font-mono">{{ availableArgs.join(', ') }}</span>
      </p>

      <div v-if="paramFields.length" class="grid grid-cols-2 gap-3">
        <WorkflowTargetParamField
          v-for="f in paramFields"
          :key="f.key"
          :field="f"
          :model-value="params[f.key]"
          :token-mode="!!tokenMode[f.key]"
          :show-token-toggle="hasSignalWire"
          @update:model-value="params[f.key] = $event"
          @update:token-mode="tokenMode[f.key] = $event"
        />
      </div>

      <Button :disabled="saving" @click="submit">Save</Button>
    </template>
  </div>
</template>
