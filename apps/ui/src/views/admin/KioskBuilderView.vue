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
import { computed, getCurrentInstance, h, nextTick, onBeforeUnmount, onMounted, ref, render, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { GridStack, type GridStackNode, type GridStackWidget } from 'gridstack'
import 'gridstack/dist/gridstack.min.css'
import { ArrowLeftIcon, ExternalLinkIcon, GripVerticalIcon, InfoIcon, SaveIcon } from '@lucide/vue'
import type { KioskDTO, KioskTile, KioskUpdateInput } from '@gallery/types'
import { useDevicesStore } from '@/stores/devices'
import { KIOSK_GAP } from '@/lib/kiosks'
import { Button } from '@/components/ui/button'
import DeviceWidget from '@/components/devices/DeviceWidget.vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'

const DEFAULT_TILE_W = 2
const DEFAULT_TILE_H = 1

const appContext = getCurrentInstance()!.appContext

const route = useRoute()
const router = useRouter()
const devices = useDevicesStore()

const loading = ref(false)
const kiosk: Ref<KioskDTO | null> = ref(null)
const error = ref(null)


async function fetchData(id: string): Promise<void> {
  error.value = null
  kiosk.value = null
  loading.value = true

  try {
    kiosk.value = await fetch(`/api/v1/kiosks/${encodeURIComponent(id)}`).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch kiosk: ${res.statusText}`)
      return res.json()
    })
  } catch (err) {
    error.value = err.toString()
  } finally {
    loading.value = false
  }
}

let grid = null as GridStack | null

onMounted(async () => {
  if (route.params.id) await fetchData(route.params.id as string)
  if (!kiosk.value) return
  await nextTick()
  if (!gridEl.value) return

  grid = GridStack.init(
    {
      column:  20,
      cellHeight: kiosk.value.config.cellHeight ?? 80,
      margin: "10px",
      marginUnit: 'px',
      acceptWidgets: true,
      removable: true,
      minRow: 10
    },
    gridEl.value,
  )

  grid.on('change', syncFromGrid)
  grid.on('added', syncFromGrid)
  grid.on('removed', syncFromGrid)
  grid.on('dropped', onDropped)

  let items = kiosk.value.config.tiles ?? []
  if (items.length) {
    // Ensure all tiles have a width/height (Gridstack requires it).
    items = items.filter((t) => devices.records.some((d) => d.id === t.deviceId))
    items.forEach((t) => {
      grid?.makeWidget(buildTileEl(t))
    })

  }


  grid.load(items)
  setupPaletteDrag()
})

// Devices we know how to render, mirroring the main user UI palette.
const paletteDevices = computed(() => devices.devices)

const gridEl = ref<HTMLDivElement>()
// const dirty = ref(false)
const saving = ref(false)
// const loadFailed = ref(false)

// // ── Gridstack state (imperative; not reactive on purpose) ───────────────────

// /** Build the imperative DOM for one tile (label + remove button). */
function buildTileEl(tile: KioskTile): HTMLDivElement {
  const device = devices.records.find((d) => d.id === tile.deviceId)
  if (!device) throw new Error(`Device not found for tile: ${tile.deviceId}`)

  const item = document.createElement('div')
  const vnode = h(TooltipProvider, null, () =>
    h(DeviceWidget, { device, class: 'pointer-events-none' }),
  )
  vnode.appContext = appContext
  render(vnode, item)

  item.className = 'grid-stack-item'
  // item.dataset.tileId = tile.id
  item.setAttribute('gs-x', String(tile.x))
  item.setAttribute('gs-y', String(tile.y))
  item.setAttribute('gs-w', String(tile.w))
  item.setAttribute('gs-h', String(tile.h))
  item.setAttribute('gs-id', device.id)

  return item
}

// /** Add a tile to the grid (Gridstack adopts our pre-positioned element). */
function addTile(tile: Omit<KioskTile, 'id'>): void {
  if (!grid) return
  // tileDevice.set(tileId, tile.deviceId)
  const el = buildTileEl({...tile, id: crypto.randomUUID()})
  grid.makeWidget(el)
}


const currentTiles = ref<KioskTile[]>([])

// /** Read the current Gridstack layout back into `currentTiles` and mark dirty. */
function syncFromGrid(): void {
  console.log('syncFromGrid', grid?.save(false))
  const saved = grid?.save(false) as GridStackWidget[]
  currentTiles.value = saved
    .map((w) => {
      const deviceId = String(w.id ?? '')
      return {
        id: deviceId,
        deviceId: deviceId,
        x: w.x ?? 0,
        y: w.y ?? 0,
        w: w.w ?? 2,
        h: w.h ?? 1,
      }
    })
    .filter((t) => t.deviceId)
}

// /** A palette item was dropped: drop Gridstack's placeholder, add our own tile. */
function onDropped(_event: Event, _previous: GridStackNode, node: GridStackNode): void {
  const droppedElement = node.el as HTMLElement
  const deviceId = droppedElement?.dataset?.deviceId
  console.log('onDropped', node, droppedElement, deviceId)

  const pos = { x: node.x ?? 0, y: node.y ?? 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H }
  if (node.el) grid?.removeWidget(node.el, true, false)
  if (deviceId) addTile({ deviceId, ...pos })
}

// /** Register the palette chips as Gridstack drag sources with a default size. */
function setupPaletteDrag(): void {
  GridStack.setupDragIn('.kiosk-palette-item', { appendTo: 'body', helper: 'clone' })
}





async function save(): Promise<void> {
  const k = kiosk.value
  if (!k) return
  saving.value = true

  const updateInput: KioskUpdateInput = {
    config: {
      ...k.config,
      tiles: currentTiles.value,
    },
  }

  console.log('Saving kiosk layout', k.id, JSON.stringify(updateInput))

  api.kiosks.update(k.id, updateInput)
    .then((updated) => {
      saving.value = false
      if (updated) {
        toast.success('Layout saved')
      }
    })
    .catch((err) => {
      saving.value = false
      toast.error(`Failed to save layout: ${err}`)
    })

  saving.value = false
    toast.success('Layout saved')
}

const viewerHref = kiosk.value ? `/kiosk/${encodeURIComponent(kiosk.value.name)}` : '#'


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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to layouts"
          @click="router.push('/admin/layouts')"
        >
          <ArrowLeftIcon class="size-4" />
        </Button>
        <div class="min-w-0">
          <p class="truncate font-medium">{{ kiosk.name }}</p>
          <p class="text-muted-foreground text-xs tabular-nums">
            {{ kiosk.width }}×{{ kiosk.height }} · {{ kiosk.config.columns }} cols · {{ currentTiles.length }}
            tiles
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <a :href="viewerHref" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" size="sm">
            <ExternalLinkIcon class="size-4" />
            Open viewer
          </Button>
        </a>
        <Button size="sm" :disabled="saving" @click="save">
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
            class="grid-stack-item kiosk-palette-item bg-card hover:border-primary/50 flex cursor-grab items-center gap-2 rounded-md border px-2.5 py-2 text-sm active:cursor-grabbing select-none"
            :data-device-id="d.id"
            draggable="true"
          >
            <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
            <div class="min-w-0">
              <p class="truncate font-medium">{{ d.name }}</p>
              <p class="text-muted-foreground truncate text-xs">{{ d.subtype ?? d.type }}</p>
            </div>
          </div>
          <p
            v-if="!paletteDevices.length"
            class="text-muted-foreground px-1 py-4 text-center text-xs"
          >
            No controllable devices found.
          </p>
        </div>
      </aside>

      <!-- Canvas (scrolls when larger than the viewport) -->
      <div class="bg-muted/30 min-w-0 flex-1 overflow-auto p-4">
        <TooltipProvider>

          <div
          ref="gridEl"
          class="grid-stack kiosk-canvas"
          :style="{ height: kiosk.height + 'px', width: kiosk.width + 'px' }"
          />
        </TooltipProvider>
      </div>
    </div>
  </div>

  <div v-else-if="error" class="flex h-full flex-col items-center justify-center gap-3 text-center">
    <p class="text-muted-foreground text-sm">Layout not found.</p>
    <Button variant="outline" size="sm" @click="router.push('/admin/layouts')">
      Back to layouts
    </Button>
  </div>

  <p v-else class="text-muted-foreground p-6 text-sm">Loading layout…</p>
</template>

<!-- Not scoped: Gridstack builds tile DOM imperatively, so scoped (data-v) rules
     would not reach it. Class names are kiosk-prefixed to avoid leakage. -->
<style>
.grid-stack-item {
  overflow: hidden;
}
.kiosk-canvas {
  background-image:
    linear-gradient(
      to right,
      color-mix(in srgb, var(--border) 60%, transparent) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--border) 60%, transparent) 1px,
      transparent 1px
    );
  background-size: 160px 80px;
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
