<script setup lang="ts">
/**
 * Kiosk layout builder — a Gridstack canvas the admin fills by dragging device
 * widgets from the palette. Tiles can be moved, resized (spanning rows/columns)
 * and removed; Gridstack enforces bounds and prevents overlap.
 *
 * Gridstack owns the grid DOM entirely (imperative): tiles are plain labelled
 * placeholders built with `document.createElement`, never Vue-rendered, so Vue's
 * virtual DOM and Gridstack never fight over the same nodes. The *live* device
 * widgets render in the read-only viewer (`/kiosk/:name`); here the admin is
 * only positioning, so a name + type placeholder is clearer and lighter.
 *
 * The current grid is serialised back to `kiosk.config.tiles` and saved via the
 * kiosks store. The viewer reproduces the identical geometry with a CSS grid.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  GridStack,
  type GridStackNode,
  type GridStackWidget,
} from 'gridstack'
import 'gridstack/dist/gridstack.min.css'
import { ArrowLeftIcon, ExternalLinkIcon, GripVerticalIcon, SaveIcon } from '@lucide/vue'
import type { KioskDTO, KioskTile } from '@gallery/types'
import { useKiosksStore } from '@/stores/kiosks'
import { useDevicesStore } from '@/stores/devices'
import { KIOSK_GAP, withTiles } from '@/lib/kiosks'
import { deviceKind } from '@/lib/devices'
import { Button } from '@/components/ui/button'

const DEFAULT_TILE_W = 3
const DEFAULT_TILE_H = 2

const route = useRoute()
const router = useRouter()
const store = useKiosksStore()
const devices = useDevicesStore()

const id = computed(() => String(route.params.id))
const kiosk = computed<KioskDTO | undefined>(() => store.byId(id.value))

// Devices we know how to render, mirroring the main user UI palette.
const paletteDevices = computed(() => devices.devices)

const gridEl = ref<HTMLDivElement>()
const dirty = ref(false)
const saving = ref(false)
const loadFailed = ref(false)

// ── Gridstack state (imperative; not reactive on purpose) ───────────────────
let grid: GridStack | null = null
let suspendSync = false
let pendingDeviceId: string | null = null
const tileDevice = new Map<string, string>() // tileId → deviceId
let currentTiles: KioskTile[] = []

const deviceName = (deviceId: string): string =>
  devices.records.find((d) => d.id === deviceId)?.name ?? 'Unknown device'

function deviceKindLabel(deviceId: string): string {
  const d = devices.records.find((x) => x.id === deviceId)
  if (!d) return ''
  return d.subtype ?? d.type
}

/** Build the imperative DOM for one tile (label + remove button). */
function buildTileEl(tile: KioskTile): HTMLDivElement {
  const item = document.createElement('div')
  item.className = 'grid-stack-item'
  item.dataset.tileId = tile.id
  item.setAttribute('gs-x', String(tile.x))
  item.setAttribute('gs-y', String(tile.y))
  item.setAttribute('gs-w', String(tile.w))
  item.setAttribute('gs-h', String(tile.h))
  item.setAttribute('gs-id', tile.id)

  const content = document.createElement('div')
  content.className = 'grid-stack-item-content kiosk-tile'

  const info = document.createElement('div')
  info.className = 'kiosk-tile__info'
  const name = document.createElement('div')
  name.className = 'kiosk-tile__name'
  name.textContent = deviceName(tile.deviceId)
  const kind = document.createElement('div')
  kind.className = 'kiosk-tile__kind'
  kind.textContent = deviceKindLabel(tile.deviceId)
  info.append(name, kind)

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'kiosk-tile__remove'
  remove.setAttribute('aria-label', 'Remove tile')
  remove.textContent = '✕'
  remove.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    removeTile(item)
  })

  content.append(info, remove)
  item.append(content)
  return item
}

/** Add a tile to the grid (Gridstack adopts our pre-positioned element). */
function addTile(tile: KioskTile): void {
  if (!grid) return
  tileDevice.set(tile.id, tile.deviceId)
  const el = buildTileEl(tile)
  grid.el.appendChild(el)
  grid.makeWidget(el)
}

function removeTile(item: HTMLElement): void {
  if (!grid) return
  const tileId = item.dataset.tileId
  if (tileId) tileDevice.delete(tileId)
  suspendSync = true
  grid.removeWidget(item, true, false)
  suspendSync = false
  syncFromGrid()
}

/** Read the current Gridstack layout back into `currentTiles` and mark dirty. */
function syncFromGrid(): void {
  if (!grid || suspendSync) return
  const saved = grid.save(false) as GridStackWidget[]
  currentTiles = saved
    .map((w) => {
      const tileId = String(w.id ?? '')
      return {
        id: tileId,
        deviceId: tileDevice.get(tileId) ?? '',
        x: w.x ?? 0,
        y: w.y ?? 0,
        w: w.w ?? 1,
        h: w.h ?? 1,
      }
    })
    .filter((t) => t.deviceId)
  dirty.value = true
}

/** A palette item was dropped: drop Gridstack's placeholder, add our own tile. */
function onDropped(_event: Event, _previous: GridStackNode, node: GridStackNode): void {
  if (!grid) return
  const deviceId = pendingDeviceId
  pendingDeviceId = null
  const pos = { x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? DEFAULT_TILE_W, h: node.h ?? DEFAULT_TILE_H }
  suspendSync = true
  if (node.el) grid.removeWidget(node.el, true, false)
  if (deviceId) addTile({ id: crypto.randomUUID(), deviceId, ...pos })
  suspendSync = false
  syncFromGrid()
}

/** Register the palette chips as Gridstack drag sources with a default size. */
function setupPaletteDrag(): void {
  GridStack.setupDragIn(
    '.kiosk-palette-item',
    { appendTo: 'body', helper: 'clone' },
    paletteDevices.value.map(() => ({ w: DEFAULT_TILE_W, h: DEFAULT_TILE_H })),
  )
}

function initGrid(k: KioskDTO, el: HTMLDivElement): void {
  grid = GridStack.init(
    {
      column: k.config.columns,
      cellHeight: k.config.cellHeight,
      margin: KIOSK_GAP / 2,
      float: true, // free placement — tiles stay where the admin drops them
      acceptWidgets: true,
      removable: false,
    },
    el,
  )

  suspendSync = true
  for (const tile of k.config.tiles) addTile(tile)
  suspendSync = false
  currentTiles = k.config.tiles.map((t) => ({ ...t }))
  dirty.value = false

  grid.on('change', syncFromGrid)
  grid.on('added', syncFromGrid)
  grid.on('removed', syncFromGrid)
  grid.on('dropped', onDropped)

  void nextTick(setupPaletteDrag)
}

// Initialise once both the kiosk data and the grid container are available.
watch(
  [kiosk, gridEl],
  ([k, el]) => {
    if (k && el && !grid) initGrid(k, el)
  },
  { immediate: true },
)

// Re-register drag sources when the device list finishes loading / changes.
watch(
  () => paletteDevices.value.length,
  () => {
    if (grid) void nextTick(setupPaletteDrag)
  },
)

function markPending(deviceId: string): void {
  pendingDeviceId = deviceId
}

async function save(): Promise<void> {
  const k = kiosk.value
  if (!k) return
  saving.value = true
  const updated = await store.update(k.id, { config: withTiles(k.config, currentTiles) })
  saving.value = false
  if (updated) {
    dirty.value = false
    toast.success('Layout saved')
  }
}

const viewerHref = computed(() => (kiosk.value ? `/kiosk/${encodeURIComponent(kiosk.value.name)}` : '#'))

const canvasStyle = computed(() =>
  kiosk.value ? { width: `${kiosk.value.width}px`, minHeight: `${kiosk.value.height}px` } : {},
)

;(async () => {
  if (!store.loaded) await store.fetchAll()
  if (!devices.records.length) await devices.fetchAll()
  if (store.loaded && !kiosk.value) loadFailed.value = true
})()

onBeforeUnmount(() => {
  // Tear down Gridstack listeners but leave the DOM for Vue to unmount.
  grid?.destroy(false)
  grid = null
})
</script>

<template>
  <div v-if="kiosk" class="flex h-full min-h-0 flex-col">
    <!-- Toolbar -->
    <div class="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to layouts" @click="router.push('/admin/layouts')">
          <ArrowLeftIcon class="size-4" />
        </Button>
        <div class="min-w-0">
          <p class="truncate font-medium">{{ kiosk.name }}</p>
          <p class="text-muted-foreground text-xs tabular-nums">
            {{ kiosk.width }}×{{ kiosk.height }} · {{ kiosk.config.columns }} cols · {{ currentTiles.length }} tiles
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="dirty" class="text-muted-foreground text-xs">Unsaved changes</span>
        <a :href="viewerHref" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <ExternalLinkIcon class="size-4" />
            Open viewer
          </Button>
        </a>
        <Button size="sm" :disabled="saving || !dirty" @click="save">
          <SaveIcon class="size-4" />
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- Palette -->
      <aside class="flex w-64 shrink-0 flex-col border-r">
        <div class="border-b px-3 py-2">
          <p class="text-sm font-medium">Widgets</p>
          <p class="text-muted-foreground text-xs">Drag a device onto the canvas</p>
        </div>
        <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          <div
            v-for="d in paletteDevices"
            :key="d.id"
            class="kiosk-palette-item bg-card hover:border-primary/50 flex cursor-grab items-center gap-2 rounded-md border px-2.5 py-2 text-sm active:cursor-grabbing"
            @pointerdown="markPending(d.id)"
          >
            <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
            <div class="min-w-0">
              <p class="truncate font-medium">{{ d.name }}</p>
              <p class="text-muted-foreground truncate text-xs">{{ d.subtype ?? d.type }}</p>
            </div>
          </div>
          <p v-if="!paletteDevices.length" class="text-muted-foreground px-1 py-4 text-center text-xs">
            No controllable devices found.
          </p>
        </div>
      </aside>

      <!-- Canvas (scrolls when larger than the viewport) -->
      <div class="bg-muted/30 min-w-0 flex-1 overflow-auto p-4">
        <div ref="gridEl" class="grid-stack kiosk-canvas" :style="canvasStyle" />
      </div>
    </div>
  </div>

  <div v-else-if="loadFailed" class="flex h-full flex-col items-center justify-center gap-3 text-center">
    <p class="text-muted-foreground text-sm">Layout not found.</p>
    <Button variant="outline" size="sm" @click="router.push('/admin/layouts')">Back to layouts</Button>
  </div>

  <p v-else class="text-muted-foreground p-6 text-sm">Loading layout…</p>
</template>

<!-- Not scoped: Gridstack builds tile DOM imperatively, so scoped (data-v) rules
     would not reach it. Class names are kiosk-prefixed to avoid leakage. -->
<style>
.kiosk-canvas {
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--border) 60%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--border) 60%, transparent) 1px, transparent 1px);
  background-size: 40px 40px;
  outline: 1px dashed var(--border);
}
.kiosk-tile {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.25rem;
  height: 100%;
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  background: var(--card);
  padding: 0.5rem 0.625rem;
  overflow: hidden;
}
.kiosk-tile__info {
  min-width: 0;
}
.kiosk-tile__name {
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kiosk-tile__kind {
  font-size: 0.6875rem;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kiosk-tile__remove {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  line-height: 1;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
  cursor: pointer;
}
.kiosk-tile__remove:hover {
  background: var(--destructive);
  color: var(--destructive-foreground, #fff);
}
</style>
