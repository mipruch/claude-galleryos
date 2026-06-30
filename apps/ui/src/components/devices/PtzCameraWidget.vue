<script setup lang="ts">
/**
 * PTZ camera widget for the user panel.
 *
 * Shows power state, 8-direction joystick (pan/tilt), zoom controls, and a
 * preset recall strip (presets 0–7). Sends VISCA commands via the shared
 * device store WebSocket.
 */
import { computed } from 'vue'
import {
  CameraIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  HomeIcon,
  MinusIcon,
  PlusIcon,
  PowerIcon,
} from '@lucide/vue'
import DeviceCard from './DeviceCard.vue'
import { Button } from '@/components/ui/button'
import { readOn, type DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps<{ device: DeviceRecord }>()
const store = useDevicesStore()

const on = computed(() => readOn(store.stateOf(props.device.id), 'power'))

function send(command: string, params: Record<string, unknown> = {}): void {
  store.sendCommand(props.device.id, command, params, {})
}

function togglePower(): void {
  send(on.value ? 'off' : 'on')
}

function pan(dir: 'left' | 'right'): void {
  send('move', { pan: dir, tilt: 'stop', panSpeed: 8, tiltSpeed: 8 })
}
function tilt(dir: 'up' | 'down'): void {
  send('move', { pan: 'stop', tilt: dir, panSpeed: 8, tiltSpeed: 8 })
}
function panTilt(pan: 'left' | 'right' | 'stop', tilt: 'up' | 'down' | 'stop'): void {
  send('move', { pan, tilt, panSpeed: 8, tiltSpeed: 8 })
}
function stop(): void {
  send('move', { pan: 'stop', tilt: 'stop' })
}
function home(): void {
  send('home')
}
function zoomIn(): void {
  send('zoomIn')
}
function zoomOut(): void {
  send('zoomOut')
}
function zoomStop(): void {
  send('zoomStop')
}
function recallPreset(n: number): void {
  send('recallPreset', { preset: n })
}
</script>

<template>
  <DeviceCard :device="device">
    <div class="flex flex-col gap-3">
      <!-- Power + status row -->
      <div class="flex items-center justify-between">
        <span class="flex items-center gap-2 text-sm">
          <CameraIcon class="text-muted-foreground size-4 shrink-0" />
          <span :class="on ? 'text-emerald-500' : 'text-muted-foreground'">
            {{ on ? 'On' : 'Off' }}
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          :class="on ? 'text-emerald-500' : 'text-muted-foreground'"
          @click="togglePower"
        >
          <PowerIcon class="size-4" />
        </Button>
      </div>

      <!-- PTZ joystick grid + zoom column -->
      <div class="flex items-center gap-2">
        <!-- 3×3 joystick grid -->
        <div class="grid grid-cols-3 gap-0.5">
          <!-- row 1 -->
          <Button variant="outline" size="icon" class="size-7" @mousedown="panTilt('left','up')" @mouseup="stop" @mouseleave="stop">
            <ChevronLeftIcon class="size-3 -translate-x-px -translate-y-px" />
          </Button>
          <Button variant="outline" size="icon" class="size-7" @mousedown="tilt('up')" @mouseup="stop" @mouseleave="stop">
            <ChevronUpIcon class="size-3" />
          </Button>
          <Button variant="outline" size="icon" class="size-7" @mousedown="panTilt('right','up')" @mouseup="stop" @mouseleave="stop">
            <ChevronRightIcon class="size-3 translate-x-px -translate-y-px" />
          </Button>
          <!-- row 2 -->
          <Button variant="outline" size="icon" class="size-7" @mousedown="pan('left')" @mouseup="stop" @mouseleave="stop">
            <ChevronLeftIcon class="size-3" />
          </Button>
          <Button variant="outline" size="icon" class="size-7" @click="home">
            <HomeIcon class="size-3" />
          </Button>
          <Button variant="outline" size="icon" class="size-7" @mousedown="pan('right')" @mouseup="stop" @mouseleave="stop">
            <ChevronRightIcon class="size-3" />
          </Button>
          <!-- row 3 -->
          <Button variant="outline" size="icon" class="size-7" @mousedown="panTilt('left','down')" @mouseup="stop" @mouseleave="stop">
            <ChevronLeftIcon class="size-3 -translate-x-px translate-y-px" />
          </Button>
          <Button variant="outline" size="icon" class="size-7" @mousedown="tilt('down')" @mouseup="stop" @mouseleave="stop">
            <ChevronDownIcon class="size-3" />
          </Button>
          <Button variant="outline" size="icon" class="size-7" @mousedown="panTilt('right','down')" @mouseup="stop" @mouseleave="stop">
            <ChevronRightIcon class="size-3 translate-x-px translate-y-px" />
          </Button>
        </div>

        <!-- Zoom column -->
        <div class="flex flex-col gap-0.5">
          <Button variant="outline" size="icon" class="size-7" @mousedown="zoomIn" @mouseup="zoomStop" @mouseleave="zoomStop">
            <PlusIcon class="size-3" />
          </Button>
          <div class="bg-border h-px w-7" />
          <Button variant="outline" size="icon" class="size-7" @mousedown="zoomOut" @mouseup="zoomStop" @mouseleave="zoomStop">
            <MinusIcon class="size-3" />
          </Button>
        </div>
      </div>

      <!-- Preset strip: 8 quick-recall buttons -->
      <div class="flex flex-wrap gap-1">
        <Button
          v-for="n in 8"
          :key="n"
          variant="outline"
          size="sm"
          class="h-6 min-w-[2rem] px-1.5 text-xs"
          @click="recallPreset(n - 1)"
        >
          P{{ n }}
        </Button>
      </div>
    </div>
  </DeviceCard>
</template>
