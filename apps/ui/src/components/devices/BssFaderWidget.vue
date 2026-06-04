<script setup lang="ts">
/**
 * BSS audio fader with mute toggle.
 *
 * Works for both bss-soundweb.fader (mic/bus) and bss-soundweb.matrix
 * (crosspoint), but the mute parameter means the OPPOSITE thing in each case:
 *
 *   Regular fader  — muted=true  → signal is OFF (audio mute, 0 dB blocked)
 *   Matrix         — muted=true  → route is  ON  (BSS muteParam is an *enable*:
 *                                                  value 1 = crosspoint active)
 *
 * To give the user a consistent "switch ON = channel is muted/blocked" UX in
 * both cases, the matrix inverts the raw muted value before display and before
 * sending the command back to the driver.
 */
import { computed } from 'vue'
import { Volume2Icon, VolumeXIcon } from '@lucide/vue'
import DeviceCard from './DeviceCard.vue'
import FaderControl from './FaderControl.vue'
import { Switch } from '@/components/ui/switch'
import { deviceKind, readLevel, readOn, type DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps<{ device: DeviceRecord }>()
const store = useDevicesStore()

const isMatrix = computed(() => deviceKind(props.device) === 'bssMatrix')
const level = computed(() => readLevel(store.stateOf(props.device.id), 'level'))

// Raw BSS muted flag. For matrix, true = route ON (needs inversion for display).
const rawMuted = computed(() => readOn(store.stateOf(props.device.id), 'muted'))

// Whether the channel is "muted" from the user's perspective:
//   regular → directly muted
//   matrix  → inverted, because muted=true means the route is *active*
const muted = computed(() => (isMatrix.value ? !rawMuted.value : rawMuted.value))

function onInput(value: number): void {
  store.patchState(props.device.id, { level: value })
}
function onCommit(value: number): void {
  store.sendCommand(props.device.id, 'setLevel', { level: value }, { level: value })
}
function onMute(value: boolean): void {
  // value = the user's "is this muted?" intent.
  // For matrix, invert back to the BSS enable convention before sending.
  const bssMuted = isMatrix.value ? !value : value
  store.sendCommand(props.device.id, 'setMute', { muted: bssMuted }, { muted: bssMuted })
}
</script>

<template>
  <DeviceCard :device="device">
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <component
          :is="muted ? VolumeXIcon : Volume2Icon"
          class="size-4 shrink-0"
          :class="muted ? 'text-destructive' : 'text-muted-foreground'"
        />
        <FaderControl
          class="flex-1"
          :model-value="level"
          :dimmed="muted"
          @update:model-value="onInput"
          @commit="onCommit"
        />
      </div>
      <label class="flex items-center justify-between">
        <span class="text-muted-foreground text-sm">Mute</span>
        <Switch :model-value="muted" @update:model-value="onMute" />
      </label>
    </div>
  </DeviceCard>
</template>
