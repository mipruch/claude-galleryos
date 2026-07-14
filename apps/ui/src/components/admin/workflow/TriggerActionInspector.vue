<script setup lang="ts">
/**
 * Right-sidebar inspector for a selected trigger-action edge — what a
 * mapping/schedule fires: a scene run or a device command. `targetType` and
 * `targetId` are fixed by the wire that created this action (see
 * `workflowGraph.ts`'s module doc) and shown read-only here; to fire
 * something else, delete this action and draw a new connection. A
 * device.command action's command and params stay editable in place.
 *
 * Params render as typed widgets resolved from the command's schema — a
 * Switch for booleans, a Select for enums, an Input otherwise — the same
 * pattern `SceneActionRow.vue` uses for scene actions. A mapping-owned action
 * additionally gets a per-field toggle to reference the firing signal
 * (`{arg[0]}`/`{:name}`) instead of a literal value; a schedule-owned action
 * has no signal to reference, so every field stays a plain widget.
 *
 * The parent view keys this component on the selected edge's id, so a fresh
 * instance mounts per selection and the local `params`/`tokenMode` state
 * never needs re-hydrating mid-lifetime (see `TriggerInspector` for the same
 * pattern).
 */
import { computed, reactive, ref, watch } from 'vue'
import { PlayCircleIcon, SlidersHorizontalIcon, Trash2Icon } from '@lucide/vue'
import type { TriggerActionDTO } from '@gallery/types'
import { useTriggerActionsStore } from '@/stores/triggerActions'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import { schemaToFields } from '@/lib/schemaForm'
import { resolveTargetNames, targetSummary, usesParams } from '@/lib/triggerActions'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import TriggerActionParamField from './TriggerActionParamField.vue'

const props = defineProps<{ action: TriggerActionDTO }>()
const emit = defineEmits<{ remove: [] }>()

const store = useTriggerActionsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()
const { commandsFor, paramsSchemaFor } = useDeviceCommands()

const isScene = computed(() => props.action.targetType === 'scene.execute')
/** A schedule fire has no signal to template against — its params are always literal. */
const isTemplated = computed(() => !!props.action.mappingId)
const summary = computed(() =>
  targetSummary(props.action.targetType, resolveTargetNames(props.action, scenes.records, devices.records)),
)

const targetCommand = ref(props.action.targetCommand ?? '')
const params = reactive<Record<string, unknown>>({ ...props.action.params })

/** Fields whose stored value already looks like a template token — defaults that field's toggle to "from signal". */
const TOKEN_PATTERN = /\{(?:arg\[\d+\]|:[A-Za-z_][\w-]*)\}/
const tokenMode = reactive<Record<string, boolean>>({})
for (const [key, value] of Object.entries(params)) {
  tokenMode[key] = typeof value === 'string' && TOKEN_PATTERN.test(value)
}

const deviceCommands = computed(() => commandsFor(props.action.targetId ?? ''))
const paramFields = computed(() => schemaToFields(paramsSchemaFor(props.action.targetId ?? '', targetCommand.value)))

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
    await store.update(props.action.id, {
      targetCommand: targetCommand.value || null,
      params: { ...params },
    })
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  await store.remove(props.action.id)
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
    <p class="text-muted-foreground text-xs">To fire something else, delete this action and draw a new connection.</p>

    <template v-if="usesParams(action.targetType)">
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

      <div v-if="paramFields.length" class="grid grid-cols-2 gap-3">
        <TriggerActionParamField
          v-for="f in paramFields"
          :key="f.key"
          :field="f"
          :model-value="params[f.key]"
          :token-mode="!!tokenMode[f.key]"
          :show-token-toggle="isTemplated"
          @update:model-value="params[f.key] = $event"
          @update:token-mode="tokenMode[f.key] = $event"
        />
      </div>

      <Button :disabled="saving" @click="submit">Save</Button>
    </template>
  </div>
</template>
