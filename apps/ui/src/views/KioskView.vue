<script setup lang="ts">
/**
 * Chromeless kiosk viewer (`/kiosk/:name`) — a fixed-pixel canvas of live device
 * widgets, no header or sidebar. Toasts and tooltips come from the global shell
 * in `App.vue`.
 *
 * Looked up by name via `api.kiosks.byName` — this view previously called
 * `byId` with the route's name param, which 404'd since the admin Layouts/
 * Builder pages always link here by name, not id.
 *
 * Gated by the kiosk's own front-end-only PIN (see PLAN.md "Priority 6"): if
 * `kiosk.pin` is set and this browser hasn't unlocked it this session,
 * `KioskPinPad` shows instead of the canvas. This is independent of the
 * general username/password login — a kiosk session never sets `auth.user`,
 * so `App.vue`'s auth-driven hydration never fires here; this view opens the
 * realtime socket and hydrates the devices store itself once unlocked.
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
import { useRealtimeStore } from '@/stores/realtime'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import DeviceWidget from '@/components/devices/DeviceWidget.vue'
import KioskPinPad from '@/components/kiosk/KioskPinPad.vue'

const route = useRoute()
const devices = useDevicesStore()
const realtime = useRealtimeStore()

const UNLOCK_STORAGE_PREFIX = 'galleryos-kiosk-unlocked:'

const kiosk = ref<KioskDTO | null>(null)
const loading = ref(true)
const notFound = ref(false)
const unlocked = ref(false)
const pinError = ref(false)

function wasUnlocked(kioskId: string): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_STORAGE_PREFIX + kioskId) === '1'
  } catch {
    return false
  }
}

function rememberUnlocked(kioskId: string): void {
  try {
    sessionStorage.setItem(UNLOCK_STORAGE_PREFIX + kioskId, '1')
  } catch {
    // ignore storage failures — stays unlocked for this page view at least
  }
}

/** Opens the shared socket + hydrates devices — App.vue never does this for a
 * kiosk-only session, since it never sets `auth.user`. */
async function hydrate(): Promise<void> {
  realtime.open()
  if (!devices.records.length) await devices.fetchAll()
}

async function load(name: string): Promise<void> {
  loading.value = true
  notFound.value = false
  pinError.value = false
  kiosk.value = null
  unlocked.value = false
  try {
    kiosk.value = await api.kiosks.byName(name)
    if (kiosk.value) {
      unlocked.value = !kiosk.value.pin || wasUnlocked(kiosk.value.id)
      if (unlocked.value) await hydrate()
    }
  } catch (err) {
    // A 404 is an expected "no such kiosk"; anything else is a real error.
    if (errMsg(err).toLowerCase().includes('not found')) notFound.value = true
    else toast.error('Could not load kiosk', { description: errMsg(err) })
  } finally {
    loading.value = false
  }
}

async function attemptUnlock(pin: string): Promise<void> {
  if (!kiosk.value) return
  if (pin !== kiosk.value.pin) {
    pinError.value = true
    return
  }
  pinError.value = false
  unlocked.value = true
  rememberUnlocked(kiosk.value.id)
  await hydrate()
}

watch(
  () => route.params.name,
  (name) => void load(typeof name === 'string' ? name : ''),
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
    <KioskPinPad v-if="kiosk && !unlocked" :error="pinError" @submit="attemptUnlock" />

    <div v-else-if="kiosk" :style="canvasGridStyle(kiosk)">
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
      <p class="text-muted-foreground text-sm">No layout named “{{ route.params.name }}”.</p>
    </div>

    <div v-else class="flex min-h-screen items-center justify-center">
      <p class="text-muted-foreground text-sm">Could not load this kiosk.</p>
    </div>
  </div>
</template>
