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
  // Only update the state key(s) the driver actually uses so we don't leave
  // stale aliased keys that would confuse readOn after a scene updates just
  // one key. E.g. PJLink uses `power` (string); sockets/relays use `on` (boolean).
  const current = store.stateOf(props.device.id)
  const hasPower = 'power' in current
  const hasOn = 'on' in current
  const optimistic: DeviceState = {}
  if (hasOn) optimistic.on = value
  if (hasPower) optimistic.power = value ? 'on' : 'off'
  // No state loaded yet — set both as fallback.
  if (!hasOn && !hasPower) { optimistic.on = value; optimistic.power = value ? 'on' : 'off' }
  store.sendCommand(props.device.id, value ? 'on' : 'off', {}, optimistic)
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
