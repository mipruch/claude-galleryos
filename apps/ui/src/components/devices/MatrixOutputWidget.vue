<script setup lang="ts">
/**
 * Extron matrix output: one select that routes an input to this output.
 *
 * An output device exposes a single choice — "which input feeds me?" — so the
 * 10×8 matrix never appears as a grid. Picking an option sends `setInput`
 * (audio + video together); `None` (input 0) unties the output.
 */
import { computed } from 'vue'
import { ArrowRightLeftIcon } from '@lucide/vue'
import DeviceCard from './DeviceCard.vue'
import { matrixInputs, readInt, type DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'

const props = defineProps<{ device: DeviceRecord }>()
const store = useDevicesStore()
const connections = useConnectionsStore()

// Input labels belong to the matrix (the connection), so they're read once from
// the connection's config and shared by every output of this switcher.
const inputs = computed(() => matrixInputs(connections.configOf(props.device.connectionId)))
const current = computed(() => readInt(store.stateOf(props.device.id), 'input'))

function onSelect(event: Event): void {
  const input = Number((event.target as HTMLSelectElement).value)
  store.sendCommand(props.device.id, 'setInput', { input }, { input })
}
</script>

<template>
  <DeviceCard :device="device">
    <label class="flex items-center gap-3">
      <ArrowRightLeftIcon class="text-muted-foreground size-4 shrink-0" />
      <span class="sr-only">Input source</span>
      <select
        class="border-input bg-background ring-offset-background focus-visible:ring-ring h-9 w-full flex-1 rounded-md border px-3 py-1 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
        :value="current"
        @change="onSelect"
      >
        <option v-for="input in inputs" :key="input.value" :value="input.value">
          {{ input.label }}
        </option>
      </select>
    </label>
  </DeviceCard>
</template>
