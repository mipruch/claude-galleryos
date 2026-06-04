<script setup lang="ts">
/** Simple on/off switch: sockets, projectors, lights. `on` / `off` commands. */
import { computed } from 'vue'
import { PowerIcon } from '@lucide/vue'
import DeviceCard from './DeviceCard.vue'
import { Switch } from '@/components/ui/switch'
import { readOn, type DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps<{ device: DeviceRecord }>()
const store = useDevicesStore()

const on = computed(() => readOn(store.stateOf(props.device.id), 'on', 'power'))

function onToggle(value: boolean): void {
  store.sendCommand(
    props.device.id,
    value ? 'on' : 'off',
    {},
    { on: value, power: value ? 'on' : 'off' },
  )
}
</script>

<template>
  <DeviceCard :device="device">
    <div class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-3">
        <PowerIcon
          class="size-4 shrink-0"
          :class="on ? 'text-emerald-500' : 'text-muted-foreground'"
        />
        <span class="text-sm">{{ on ? 'On' : 'Off' }}</span>
      </span>
      <Switch :model-value="on" @update:model-value="onToggle" />
    </div>
  </DeviceCard>
</template>
