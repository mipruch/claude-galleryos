<script setup lang="ts">
/**
 * Right-sidebar inspector for a selected trigger-action node — what a
 * mapping/schedule fires: a scene run or a device command. `targetId` (and,
 * for device.command, `targetCommand`) may be left unset; Save always
 * persists whatever's picked so far rather than blocking on a fully-wired
 * row, matching the dispatcher's "skip if unwired" behaviour.
 *
 * The parent view keys this component on the selected node's id, so a fresh
 * instance mounts per selection and `useForm`'s `initialValues` never needs
 * re-hydrating (see TriggerInspector for the same pattern). The device.command
 * fields live in a sibling component (`TriggerActionDeviceFields`) purely to
 * keep this one's template from carrying every target-type's fields at once.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { Trash2Icon } from '@lucide/vue'
import type { TriggerActionDTO } from '@gallery/types'
import { useTriggerActionsStore } from '@/stores/triggerActions'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import {
  TARGET_TYPE_OPTIONS,
  buildTriggerActionPatch,
  isValidParams,
  stringifyParams,
  usesParams,
} from '@/lib/triggerActions'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import TriggerActionDeviceFields from './TriggerActionDeviceFields.vue'

const props = defineProps<{ action: TriggerActionDTO }>()
const emit = defineEmits<{ remove: [] }>()

const store = useTriggerActionsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()
const { commandsFor } = useDeviceCommands()

/** A schedule fire has no signal to template against — its params are literal. */
const isTemplated = computed(() => !!props.action.mappingId)

const validationSchema = toTypedSchema(
  z.object({
    targetType: z.enum(['scene.execute', 'device.command']),
    targetId: z.string(),
    targetCommand: z.string(),
    params: z.string(),
  }).superRefine((v, ctx) => {
    if (usesParams(v.targetType) && !isValidParams(v.params)) {
      ctx.addIssue({ code: 'custom', path: ['params'], message: 'Must be a JSON object' })
    }
  }),
)

const { handleSubmit, isSubmitting, values, setFieldValue } = useForm({
  validationSchema,
  initialValues: {
    targetType: props.action.targetType,
    targetId: props.action.targetId ?? '',
    targetCommand: props.action.targetCommand ?? '',
    params: stringifyParams(props.action.params),
  },
})

/** Commands available for the currently-selected device. */
const deviceCommands = computed(() => (values.targetId ? commandsFor(values.targetId) : []))

// Switching target type clears fields that no longer apply, so a stale device
// id can't ride along on a scene action.
watch(
  () => values.targetType,
  () => {
    setFieldValue('targetId', '')
    setFieldValue('targetCommand', '')
  },
)

// Changing the device drops a command that the new device doesn't offer.
watch(
  () => values.targetId,
  (deviceId) => {
    if (values.targetType !== 'device.command') return
    if (deviceId && !commandsFor(deviceId).some((c) => c.command === values.targetCommand)) {
      setFieldValue('targetCommand', '')
    }
  },
)

const submit = handleSubmit(async (v) => {
  await store.update(props.action.id, buildTriggerActionPatch(v))
})

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

    <form class="flex flex-col gap-4" @submit="submit">
      <FormField v-slot="{ componentField }" name="targetType">
        <FormItem>
          <FormLabel>Fires</FormLabel>
          <Select v-bind="componentField">
            <FormControl>
              <SelectTrigger><SelectValue /></SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="t in TARGET_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- scene.execute → pick a scene -->
      <FormField v-if="values.targetType === 'scene.execute'" v-slot="{ componentField }" name="targetId">
        <FormItem>
          <FormLabel>Scene</FormLabel>
          <Select v-bind="componentField">
            <FormControl>
              <SelectTrigger><SelectValue placeholder="Not wired yet…" /></SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="s in scenes.records" :key="s.id" :value="s.id">{{ s.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- device.command → pick a device + command -->
      <TriggerActionDeviceFields
        v-else-if="values.targetType === 'device.command'"
        :devices="devices.records"
        :device-commands="deviceCommands"
        :target-id="values.targetId ?? ''"
        :is-templated="isTemplated"
      />

      <Button type="submit" :disabled="isSubmitting">Save</Button>
    </form>
  </div>
</template>
