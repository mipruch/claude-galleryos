<script setup lang="ts">
/**
 * Command palette (⌘K / Ctrl+K) — Raycast/Notion-style, keyboard-first.
 *
 * Flow: open with ⌘K → type to search devices → ↑/↓ to move, ↵ to drill into a
 * device → its quick actions (Turn on/off, Mute, level presets…) → ↵ to run.
 * Esc (or ⌫ on an empty query) steps back from the action list to the search;
 * Esc again — or a click outside — closes. Mouse is supported but secondary.
 *
 * Extensible: the result list is a flat list of `PaletteItem`s, each with its own
 * `onSelect`. Today the root lists devices; when scenes land, a scene item with
 * `onSelect: () => runScene(...)` ("Run scene: Cinema") slots straight in.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { SearchIcon, ChevronRightIcon, CornerDownLeftIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { searchDevices, typeLabel, type DeviceRecord } from '@/lib/devices'
import { deviceActions, type DeviceAction } from '@/lib/commands'
import { useDevicesStore } from '@/stores/devices'
import { useCommandPalette } from '@/composables/useCommandPalette'

interface PaletteItem {
  id: string
  title: string
  subtitle?: string
  icon?: Component
  /** What happens on ↵ / click. */
  onSelect: () => void
}

const store = useDevicesStore()
const { open, close, toggle } = useCommandPalette()

const query = ref('')
const view = ref<'root' | 'device'>('root')
const activeDevice = ref<DeviceRecord | null>(null)
const selected = ref(0)

const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

const roomName = computed(() => new Map(store.rooms.map((r) => [r.id, r.name])))

function deviceSubtitle(d: DeviceRecord): string {
  const room = d.roomId ? roomName.value.get(d.roomId) : undefined
  return [room, typeLabel(d.type)].filter(Boolean).join(' · ')
}

const results = computed<PaletteItem[]>(() => {
  if (view.value === 'device' && activeDevice.value) {
    const device = activeDevice.value
    const q = query.value.trim().toLowerCase()
    return deviceActions(device)
      .filter((a) => !q || a.label.toLowerCase().includes(q))
      .map((a) => ({
        id: a.id,
        title: a.label,
        onSelect: () => runAction(device, a),
      }))
  }
  // Root: devices (reuses the same loose search as the grid).
  return searchDevices(store.devices, query.value, store.rooms).map((d) => ({
    id: d.id,
    title: d.name,
    subtitle: deviceSubtitle(d),
    icon: ChevronRightIcon,
    onSelect: () => openDevice(d),
  }))
})

const emptyText = computed(() => {
  if (view.value === 'device') return 'No quick actions for this device.'
  return query.value ? 'No devices found.' : 'No devices yet.'
})

// ── actions ────────────────────────────────────────────────────────────────
function openDevice(device: DeviceRecord): void {
  activeDevice.value = device
  view.value = 'device'
  query.value = ''
  selected.value = 0
  focusInput()
}

async function runAction(device: DeviceRecord, action: DeviceAction): Promise<void> {
  close()
  // Confirm only once the server acks success; the store rolls back and toasts
  // the error itself on failure.
  const ok = await store.sendCommand(device.id, action.command, action.params, action.optimistic)
  if (ok) toast.success(device.name, { description: action.label })
}

function goBack(): void {
  view.value = 'root'
  activeDevice.value = null
  query.value = ''
  selected.value = 0
  focusInput()
}

// ── open / close ───────────────────────────────────────────────────────────
/** Reset to a fresh root search (run whenever the palette opens). */
function reset(): void {
  view.value = 'root'
  activeDevice.value = null
  query.value = ''
  selected.value = 0
}

function focusInput(): void {
  nextTick(() => inputEl.value?.focus())
}

// ── keyboard ───────────────────────────────────────────────────────────────
function move(delta: number): void {
  const n = results.value.length
  if (n) selected.value = (selected.value + delta + n) % n
}

function activate(): void {
  results.value[selected.value]?.onSelect()
}

function onKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      move(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      move(-1)
      break
    case 'Enter':
      e.preventDefault()
      activate()
      break
    case 'Escape':
      e.preventDefault()
      if (view.value === 'device') goBack()
      else close()
      break
    case 'Backspace':
      // Empty query in the action view → step back to the device search.
      if (view.value === 'device' && query.value === '') {
        e.preventDefault()
        goBack()
      }
      break
  }
}

function onGlobalKey(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    toggle()
  }
}

// ── reactions ──────────────────────────────────────────────────────────────
// Reset/clamp the highlighted row as the list changes, and keep it in view.
watch(query, () => (selected.value = 0))
watch(
  () => results.value.length,
  (n) => {
    if (selected.value >= n) selected.value = Math.max(0, n - 1)
  },
)
watch(selected, () => {
  nextTick(() => {
    listEl.value?.querySelector(`[data-index="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
  })
})
// On open: start fresh, focus the input, and lock background scroll.
watch(open, (isOpen) => {
  if (isOpen) {
    reset()
    focusInput()
  }
  document.body.style.overflow = isOpen ? 'hidden' : ''
})

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-start justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="close" />

      <!-- Panel -->
      <div
        class="bg-popover text-popover-foreground relative mt-[12vh] w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl"
      >
        <!-- Search input -->
        <div class="flex items-center gap-2 border-b px-3">
          <ChevronRightIcon
            v-if="view === 'device' && activeDevice"
            class="text-muted-foreground size-4 shrink-0"
          />
          <SearchIcon v-else class="text-muted-foreground size-4 shrink-0" />
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            class="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
            :placeholder="
              view === 'device' && activeDevice
                ? `${activeDevice.name} — choose an action…`
                : 'Search devices…'
            "
            aria-label="Command palette search"
            @keydown="onKeydown"
          />
        </div>

        <!-- Results -->
        <ul ref="listEl" class="max-h-80 overflow-y-auto p-1">
          <li
            v-for="(item, i) in results"
            :key="item.id"
            :data-index="i"
            class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
            :class="i === selected ? 'bg-accent text-accent-foreground' : ''"
            @click="item.onSelect()"
            @mousemove="selected = i"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate">{{ item.title }}</div>
              <div v-if="item.subtitle" class="text-muted-foreground truncate text-xs">
                {{ item.subtitle }}
              </div>
            </div>
            <CornerDownLeftIcon v-if="i === selected" class="size-3.5 shrink-0 opacity-60" />
            <component :is="item.icon" v-else-if="item.icon" class="size-4 shrink-0 opacity-40" />
          </li>

          <li v-if="!results.length" class="text-muted-foreground px-3 py-6 text-center text-sm">
            {{ emptyText }}
          </li>
        </ul>

        <!-- Footer hints -->
        <div
          class="text-muted-foreground flex items-center gap-4 border-t px-3 py-2 text-xs select-none"
        >
          <span><kbd class="font-sans">↑</kbd> <kbd class="font-sans">↓</kbd> navigate</span>
          <span><kbd class="font-sans">↵</kbd> select</span>
          <span><kbd class="font-sans">esc</kbd> {{ view === 'device' ? 'back' : 'close' }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>
