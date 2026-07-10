<script setup lang="ts">
/**
 * Generic enumerated-choice control — one `<select>` sending a command with
 * the chosen value. Covers a matrix output's input picker today; any future
 * driver's `select` widget (a scene recall list, an input source, …) works the
 * same way. Options come from `lib/widgets.ts#selectOptions` — a dynamic list
 * the driver stamped onto state, or a static one in the manifest.
 */
import { computed } from 'vue'
import { ArrowRightLeftIcon } from '@lucide/vue'
import type { SelectWidgetBinding } from '@gallery/driver-core'
import { readSelected, selectOptions } from '@/lib/widgets'
import type { DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'
import { useDeviceWidgets } from '@/composables/useDeviceWidgets'

const props = defineProps<{ device: DeviceRecord; binding: SelectWidgetBinding }>()
const store = useDevicesStore()
const { connectionConfigFor } = useDeviceWidgets()

const options = computed(() =>
  selectOptions(props.binding, store.stateOf(props.device.id), connectionConfigFor(props.device)),
)
const current = computed(() => readSelected(store.stateOf(props.device.id)[props.binding.stateKey]))
// A dynamic option list (e.g. Extron input labels) only exists once the driver
// has emitted state at least once — before that (device never connected /
// nothing sent yet), show an inert placeholder instead of a blank, broken-
// looking control. Self-heals the moment any state arrives.
const isPending = computed(() => options.value.length === 0)

function onSelect(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  // The <option> values are stringified by the DOM — recover the option's
  // original value type (number vs string) so the command param is correct.
  const matched = options.value.find((o) => String(o.value) === raw)
  const value = matched ? matched.value : raw
  const optimistic = { [props.binding.stateKey]: value }
  store.sendCommand(props.device.id, props.binding.command, { [props.binding.paramKey]: value }, optimistic)
}
</script>

<template>
  <label class="flex items-center gap-3">
    <ArrowRightLeftIcon class="text-muted-foreground size-4 shrink-0" />
    <span class="sr-only">{{ binding.stateKey }}</span>
    <select
      class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 w-full flex-1 rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-50"
      :value="current"
      :disabled="isPending"
      @change="onSelect"
    >
      <option v-if="isPending" value="">No options yet</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
  </label>
</template>
