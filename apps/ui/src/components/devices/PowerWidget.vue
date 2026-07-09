<script setup lang="ts">
/**
 * Generic boolean control — covers both `power` (on/off: sockets, projectors,
 * displays, DALI fixtures, a BSS matrix crosspoint) and `mute` (a BSS fader's
 * mute toggle) widget kinds. The only differences between them are cosmetic
 * (icon, colour, label); how to actually send the toggle is fully described by
 * the binding itself — see `WidgetBinding` in `@gallery/driver-core`.
 */
import { computed } from 'vue'
import { PowerIcon, Volume2Icon, VolumeXIcon } from '@lucide/vue'
import { Switch } from '@/components/ui/switch'
import type { BoolWidgetBinding } from '@gallery/driver-core'
import { readBoolLike } from '@/lib/widgets'
import type { DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps<{ device: DeviceRecord; binding: BoolWidgetBinding }>()
const store = useDevicesStore()

const on = computed(() => readBoolLike(store.stateOf(props.device.id)[props.binding.stateKey]))
const isMute = computed(() => props.binding.kind === 'mute')
const icon = computed(() => (isMute.value ? (on.value ? VolumeXIcon : Volume2Icon) : PowerIcon))
const label = computed(() => (isMute.value ? 'Mute' : on.value ? 'On' : 'Off'))

function onToggle(value: boolean): void {
  const binding = props.binding
  const optimistic = { [binding.stateKey]: value }
  if (binding.trigger === 'commands') {
    store.sendCommand(props.device.id, value ? binding.onCommand : binding.offCommand, {}, optimistic)
  } else {
    store.sendCommand(props.device.id, binding.command, { [binding.paramKey]: value }, optimistic)
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <span class="flex items-center gap-3">
      <component
        :is="icon"
        class="size-4 shrink-0"
        :class="on ? (isMute ? 'text-destructive' : 'text-emerald-500') : 'text-muted-foreground'"
      />
      <span class="text-sm">{{ label }}</span>
    </span>
    <Switch :model-value="on" @update:model-value="onToggle" />
  </div>
</template>
