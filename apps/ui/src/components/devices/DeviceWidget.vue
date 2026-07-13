<script setup lang="ts">
/**
 * Composes a device's card content from its manifest's generic widget
 * bindings — the driver-agnostic replacement for the old `deviceKind()`
 * subtype switch that dispatched to five bespoke widget components. A device's
 * endpoint type declares e.g. `[fader, mute]` or `[power]` or `[select]`; this
 * component stacks one small generic control per binding inside one
 * `DeviceCard`. Adding a new driver never touches this file — it only ever
 * needs manifest entries (see `packages/driver-core/src/types.ts`).
 *
 * The one deliberate exception is the BSS live-meter panel (a whole panel of
 * live bars doesn't fit any predefined widget kind) — matched by endpoint type
 * via `lib/widgets.ts#isCustomWidgetType`, same as it would need to be matched
 * even in a fully declarative system.
 */
import { computed } from 'vue'
import type { WidgetBinding } from '@gallery/driver-core'
import DeviceCard from './DeviceCard.vue'
import GenericWidget from './GenericWidget.vue'
import BssMeterWidget from './BssMeterWidget.vue'
import { useDeviceWidgets } from '@/composables/useDeviceWidgets'
import { faderRenderHints } from '@/lib/widgets'
import { useDevicesStore } from '@/stores/devices'
import type { DeviceRecord } from '@/lib/devices'

const props = defineProps<{ device: DeviceRecord }>()

const store = useDevicesStore()
const { widgetsFor, isCustomWidgetType } = useDeviceWidgets()

const isMeter = computed(() => isCustomWidgetType(props.device.subtype))
const widgets = computed(() => widgetsFor(props.device))

/** A widget binding with the composition-level render hints derived for it. */
interface RenderEntry {
  key: number
  binding: WidgetBinding
  dimmed: boolean
  blockCommit: boolean
}

/**
 * Pairs each fader with a sibling power/mute binding on the same device, if
 * any (see `faderRenderHints` in `lib/widgets.ts`). Pure composition — no
 * driver ever needs to know this happens beyond declaring `gatesFader` when
 * its "power" companion doesn't actually gate the fader's parameter.
 */
const entries = computed<RenderEntry[]>(() =>
  widgets.value.map((binding, key) => {
    if (binding.kind !== 'fader') return { key, binding, dimmed: false, blockCommit: false }
    return { key, binding, ...faderRenderHints(widgets.value, store.stateOf(props.device.id)) }
  }),
)
</script>

<template>
  <DeviceCard v-if="isMeter || entries.length" :device="device">
    <BssMeterWidget v-if="isMeter" :device="device" />
    <div v-else class="flex flex-col gap-3">
      <GenericWidget
        v-for="entry in entries"
        :key="entry.key"
        :device="device"
        :binding="entry.binding"
        :dimmed="entry.dimmed"
        :block-commit="entry.blockCommit"
      />
    </div>
  </DeviceCard>
</template>
