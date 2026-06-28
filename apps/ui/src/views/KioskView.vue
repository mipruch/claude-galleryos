<script setup lang="ts">
/**
 * Chromeless kiosk viewer (`/kiosk/:name`) — a fixed-pixel canvas of live device
 * widgets, no header or sidebar. Toasts and tooltips come from the global shell
 * in `App.vue`, and the device widgets update live via the shared devices store
 * (hydrated + socket-connected app-wide), so this view only needs the kiosk's
 * own layout.
 *
 * The layout is a plain CSS grid driven by the same `columns` / `cellHeight` /
 * tile `x,y,w,h` the Gridstack builder produced — pixel-identical, but fully
 * Vue-owned so the real interactive widgets render inside each tile. A canvas
 * larger than the display scrolls.
 */
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
import type { KioskDTO } from '@gallery/types'
import { canvasGridStyle, tileGridStyle } from '@/lib/kiosks'
import { deviceKind } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import DeviceWidget from '@/components/devices/DeviceWidget.vue'

const route = useRoute()
const devices = useDevicesStore()

const kiosk = ref<KioskDTO | null>(null)
const loading = ref(true)
const notFound = ref(false)

async function load(id: string): Promise<void> {
  loading.value = true
  notFound.value = false
  kiosk.value = null
  try {
    kiosk.value = await api.kiosks.byId(id)
    if (!devices.records.length) await devices.fetchAll()
  } catch (err) {
    // A 404 is an expected "no such kiosk"; anything else is a real error.
    if (errMsg(err).toLowerCase().includes('not found')) notFound.value = true
    else toast.error('Could not load kiosk', { description: errMsg(err) })
  } finally {
    loading.value = false
  }
}

watch(
  () => route.params.id,
  (id) => void load(typeof id === 'string' ? id : ''),
  { immediate: true },
)

/** The device record for a tile (or undefined if it was deleted). */
const deviceFor = (deviceId: string) => devices.records.find((d) => d.id === deviceId)
const isRenderable = (deviceId: string): boolean => {
  const d = deviceFor(deviceId)
  return !!d && deviceKind(d) !== 'unsupported'
}

const tiles = computed(() => kiosk.value?.config.tiles ?? [])
</script>

<template>
  <div class="bg-background text-foreground min-h-screen w-screen overflow-auto">
    <div v-if="kiosk" :style="canvasGridStyle(kiosk)">
      <div v-for="tile in tiles" :key="tile.id" :style="tileGridStyle(tile)" class="min-w-0">
        <DeviceWidget v-if="isRenderable(tile.deviceId)" :device="deviceFor(tile.deviceId)!" />
        <div
          v-else
          class="text-muted-foreground bg-muted/40 flex h-full items-center justify-center rounded-lg border border-dashed p-2 text-center text-xs"
        >
          Device unavailable
        </div>
      </div>
    </div>

    <div v-else-if="loading" class="flex min-h-screen items-center justify-center">
      <p class="text-muted-foreground text-sm">Loading kiosk…</p>
    </div>

    <div v-else-if="notFound" class="flex min-h-screen flex-col items-center justify-center gap-1 text-center">
      <p class="text-foreground text-base font-medium">Kiosk not found</p>
      <p class="text-muted-foreground text-sm">No layout with ID “{{ route.params.id }}”.</p>
    </div>

    <div v-else class="flex min-h-screen items-center justify-center">
      <p class="text-muted-foreground text-sm">Could not load this kiosk.</p>
    </div>
  </div>
</template>
