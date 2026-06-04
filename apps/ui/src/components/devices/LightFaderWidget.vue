<script setup lang="ts">
/**
 * Light brightness fader (DALI fixtures): setBrightness + on/off switch.
 *
 * Brightness is stored in Redis as the *intended* level even when the light is
 * off (the server's mergeDeviceState() rule prevents brightness from being
 * overwritten by the driver's brightness=0 off-state report). This means:
 *
 *   - storeLevel correctly reflects the desired level across all UIs.
 *   - No local "desired level" ref is needed; the store is the single source of truth.
 *   - While off, fader commits go to `patchDeviceState` (Redis + broadcast, no driver call).
 *   - While on, fader commits go to `sendCommand` (driver + Redis + broadcast).
 *
 * State field mapping:
 *   dali-lunatone → { power: boolean, brightness: number }
 *   dali-foxtron  → { on: boolean,    brightness: number }
 */
import { computed } from 'vue'
import { LightbulbIcon, PowerIcon } from '@lucide/vue'
import DeviceCard from './DeviceCard.vue'
import FaderControl from './FaderControl.vue'
import { Switch } from '@/components/ui/switch'
import { readLevel, readOn, type DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps<{ device: DeviceRecord }>()
const store = useDevicesStore()

const level = computed(() => readLevel(store.stateOf(props.device.id), 'brightness', 'level'))
const on = computed(() => readOn(store.stateOf(props.device.id), 'on', 'power'))

function onInput(value: number): void {
  // Update the fader display smoothly during drag without sending anything.
  store.patchState(props.device.id, { brightness: value })
}

function onCommit(value: number): void {
  if (on.value) {
    // Light is on: send to hardware directly.
    store.sendCommand(props.device.id, 'setBrightness', { level: value }, { brightness: value })
  } else {
    // Light is off: persist the desired level to Redis + broadcast to all UIs
    // without sending a driver command (DAPC with level > 0 would turn it on).
    store.patchDeviceState(props.device.id, { brightness: value })
  }
}

function onToggle(value: boolean): void {
  if (value) {
    // Send setBrightness at the current stored level (never 0 — fall back to 50%).
    const lvl = level.value > 0 ? level.value : 0.5
    store.sendCommand(
      props.device.id,
      'setBrightness',
      { level: lvl },
      { on: true, power: true, brightness: lvl },
    )
  } else {
    // Turn off without touching brightness — server preserves it in Redis.
    store.sendCommand(props.device.id, 'off', {}, { on: false, power: false })
  }
}
</script>

<template>
  <DeviceCard :device="device">
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <LightbulbIcon
          class="size-4 shrink-0"
          :class="on ? 'text-amber-400' : 'text-muted-foreground'"
        />
        <FaderControl
          class="flex-1"
          :model-value="level"
          :dimmed="!on"
          @update:model-value="onInput"
          @commit="onCommit"
        />
      </div>
      <label class="flex items-center justify-between">
        <span class="flex items-center gap-2 text-sm text-muted-foreground">
          <PowerIcon class="size-3.5" />
          {{ on ? 'On' : 'Off' }}
        </span>
        <Switch :model-value="on" @update:model-value="onToggle" />
      </label>
    </div>
  </DeviceCard>
</template>
