<script setup lang="ts">
/**
 * Generic 0..1 level control — covers audio faders (BSS gain), light dimmers
 * (DALI brightness), and any future driver's `fader` widget alike. Which state
 * key to read and which command/param to send on commit are fully described
 * by the binding; this component has no vendor knowledge.
 *
 * `dimmed`/`blockCommit` are composition-level niceties `DeviceWidget.vue`
 * derives from a sibling power/mute binding on the same device (if any), not
 * anything this component decides on its own:
 *   - `dimmed` — visual only, greys the fader out.
 *   - `blockCommit` — while a paired *power* switch that gates this fader is
 *     off, committing a drag persists the desired level (Redis + broadcast)
 *     instead of sending a live command, so e.g. dragging a light's brightness
 *     while it's off doesn't itself turn the light on. Not applied for a
 *     `mute` companion, nor for a `power` companion declared with
 *     `gatesFader: false` — either way the underlying parameter is still
 *     addressable, so the fader keeps working normally (see
 *     `WidgetBinding.gatesFader` in `@gallery/driver-core`).
 */
import { computed } from 'vue'
import FaderControl from './FaderControl.vue'
import type { FaderWidgetBinding } from '@gallery/driver-core'
import { readLevel } from '@/lib/widgets'
import type { DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = withDefaults(
  defineProps<{
    device: DeviceRecord
    binding: FaderWidgetBinding
    dimmed?: boolean
    blockCommit?: boolean
  }>(),
  { dimmed: false, blockCommit: false },
)
const store = useDevicesStore()

const level = computed(() => readLevel(store.stateOf(props.device.id)[props.binding.stateKey]))

function onInput(value: number): void {
  store.patchState(props.device.id, { [props.binding.stateKey]: value })
}

function onCommit(value: number): void {
  const optimistic = { [props.binding.stateKey]: value }
  if (props.blockCommit) {
    store.patchDeviceState(props.device.id, optimistic)
  } else {
    store.sendCommand(props.device.id, props.binding.command, { [props.binding.paramKey]: value }, optimistic)
  }
}
</script>

<template>
  <FaderControl :model-value="level" :dimmed="dimmed" @update:model-value="onInput" @commit="onCommit" />
</template>
