<script setup lang="ts">
/**
 * Picks the right generic control component for one widget binding. Split out
 * of `DeviceWidget.vue` so that composing several bindings for one device stays
 * a plain `v-for` — this is the only place a binding's `kind` is dispatched on.
 */
import type { WidgetBinding } from '@gallery/driver-core'
import PowerWidget from './PowerWidget.vue'
import FaderWidget from './FaderWidget.vue'
import SelectWidget from './SelectWidget.vue'
import ButtonsWidget from './ButtonsWidget.vue'
import type { DeviceRecord } from '@/lib/devices'

withDefaults(
  defineProps<{
    device: DeviceRecord
    binding: WidgetBinding
    /** Only meaningful for a `fader` binding — see FaderWidget.vue. */
    dimmed?: boolean
    blockCommit?: boolean
  }>(),
  { dimmed: false, blockCommit: false },
)
</script>

<template>
  <FaderWidget
    v-if="binding.kind === 'fader'"
    :device="device"
    :binding="binding"
    :dimmed="dimmed"
    :block-commit="blockCommit"
  />
  <PowerWidget
    v-else-if="binding.kind === 'power' || binding.kind === 'mute'"
    :device="device"
    :binding="binding"
  />
  <SelectWidget v-else-if="binding.kind === 'select'" :device="device" :binding="binding" />
  <ButtonsWidget v-else-if="binding.kind === 'buttons'" :device="device" :binding="binding" />
</template>
