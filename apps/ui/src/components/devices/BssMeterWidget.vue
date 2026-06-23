<script setup lang="ts">
/**
 * BSS live meter widget — a panel of signal-level bars (no ticks, no numbers,
 * just a bar that grows and shrinks).
 *
 * Each widget is a virtual `bss-soundweb.meter-widget` device whose address holds
 * the node and a list of meters ({ label, object, param }). While the widget is
 * mounted it subscribes (via the meters store) so the server streams just these
 * meters to this client; on unmount it unsubscribes, and the server drops the BSS
 * subscription once no one is watching.
 */
import { computed, onMounted, onUnmounted } from 'vue'
import DeviceCard from './DeviceCard.vue'
import { useMetersStore } from '@/stores/meters'
import type { DeviceRecord } from '@/lib/devices'

interface MeterDef {
  label: string
  object: number
  param?: number
}

const props = defineProps<{ device: DeviceRecord }>()
const meters = useMetersStore()

const node = computed(() => Number((props.device.address as Record<string, unknown>).node))
const definitions = computed<MeterDef[]>(() => {
  const list = (props.device.address as Record<string, unknown>).meters
  return Array.isArray(list) ? (list as MeterDef[]) : []
})

/** 0..1 level → CSS height for the bar fill. */
function barHeight(meter: MeterDef): string {
  const level = meters.levelFor(node.value, meter.object, meter.param ?? 0)
  return `${Math.round(level * 100)}%`
}

onMounted(() => meters.subscribe(props.device.id))
onUnmounted(() => meters.unsubscribe(props.device.id))
</script>

<template>
  <DeviceCard :device="device">
    <div class="flex items-stretch justify-around gap-2">
      <div
        v-for="(meter, i) in definitions"
        :key="`${meter.object}:${meter.param ?? 0}:${i}`"
        class="flex min-w-0 flex-col items-center gap-1.5"
      >
        <!-- The track; the fill grows from the bottom. -->
        <div class="bg-muted relative h-40 w-3.5 overflow-hidden rounded-full">
          <div
            class="absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t from-emerald-500 to-lime-400 transition-[height] duration-100 ease-out"
            :style="{ height: barHeight(meter) }"
          />
        </div>
        <span class="text-muted-foreground max-w-14 truncate text-center text-xs" :title="meter.label">
          {{ meter.label }}
        </span>
      </div>
    </div>
  </DeviceCard>
</template>
