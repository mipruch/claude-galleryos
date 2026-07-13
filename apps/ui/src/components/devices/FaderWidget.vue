<script setup lang="ts">
/**
 * Generic 0..1 level control — covers audio faders (BSS gain), light dimmers
 * (DALI brightness), and any future driver's `fader` widget alike. Which state
 * key to read and which command/param to send on commit are fully described
 * by the binding; this component has no vendor knowledge.
 *
 * A commit always sends `device:command` — whether that reaches the hardware
 * right now or is only remembered for later (e.g. a light's brightness while
 * it's off) is entirely the driver's decision, not the UI's (see
 * `DaliLunatoneDriver`'s KV-backed power tracking). `dimmed` is a visual-only
 * nicety `DeviceWidget.vue` derives from a sibling power/mute binding, if any.
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
  }>(),
  { dimmed: false },
)
const store = useDevicesStore()

const level = computed(() => readLevel(store.stateOf(props.device.id)[props.binding.stateKey]))

function onInput(value: number): void {
  store.patchState(props.device.id, { [props.binding.stateKey]: value })
}

function onCommit(value: number): void {
  const optimistic = { [props.binding.stateKey]: value }
  store.sendCommand(props.device.id, props.binding.command, { [props.binding.paramKey]: value }, optimistic)
}
</script>

<template>
  <FaderControl :model-value="level" :dimmed="dimmed" @update:model-value="onInput" @commit="onCommit" />
</template>
