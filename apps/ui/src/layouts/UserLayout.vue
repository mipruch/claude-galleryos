<script setup lang="ts">
/**
 * User-panel shell for the root (`/`, `/rooms/:id`, `/schedules`, `/iframes/:id`)
 * routes — the touch-optimised device-control UI. Lifted out of `App.vue` so the
 * admin section can use its own shell; app-wide lifecycle (the shared socket and
 * store hydration) stays global in `App.vue`.
 */
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { SearchIcon, WifiIcon, WifiOffIcon } from '@lucide/vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import ConnectionStatus from '@/components/connections/ConnectionStatus.vue'
import CommandPalette from '@/components/command/CommandPalette.vue'
import { useDevicesStore } from '@/stores/devices'
import { useCommandPalette } from '@/composables/useCommandPalette'

const store = useDevicesStore()
const route = useRoute()
const { openPalette } = useCommandPalette()

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const shortcutHint = computed(() => (isMac ? '⌘K' : 'Ctrl K'))

// The URL is the source of truth for the device scope: `/` → all devices,
// `/rooms/:roomId` → that room. Runs immediately so a refresh restores scope.
watch(
  () => route.params.roomId,
  (id) => store.setRoomScope(typeof id === 'string' && id ? id : null),
  { immediate: true },
)

const pageTitle = computed(() => {
  if (typeof route.meta.title === 'string') return route.meta.title
  return store.currentRoom?.name ?? 'All devices'
})
const pageSubtitle = computed(() => {
  if (typeof route.meta.subtitle === 'string') return route.meta.subtitle
  const n = store.scopedDevices.length
  return `${n} ${n === 1 ? 'device' : 'devices'}`
})
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <!-- Offline banner -->
    <div
      v-if="!store.connected"
      class="bg-destructive/10 text-destructive flex items-center justify-center gap-2 px-4 py-1.5 text-sm"
    >
      <WifiOffIcon class="size-4" />
      <span>Realtime connection lost — reconnecting…</span>
    </div>

    <div class="flex min-h-0 flex-1">
      <AppSidebar />

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center justify-between gap-4 border-b px-6 py-4">
          <div class="min-w-0">
            <h2 class="truncate text-xl font-semibold tracking-tight">{{ pageTitle }}</h2>
            <p class="text-muted-foreground text-sm">{{ pageSubtitle }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2"
              aria-label="Open command palette"
              @click="openPalette()"
            >
              <SearchIcon class="size-3.5" />
              <span class="hidden sm:inline">Search</span>
              <kbd class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-sans text-[10px]">
                {{ shortcutHint }}
              </kbd>
            </button>

            <ConnectionStatus />

            <span
              class="flex items-center gap-1.5 text-xs"
              :class="store.connected ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'"
            >
              <component :is="store.connected ? WifiIcon : WifiOffIcon" class="size-4" />
              {{ store.connected ? 'Live' : 'Offline' }}
            </span>
          </div>
        </header>

        <main class="w-full flex-1">
          <RouterView />
        </main>
      </div>
    </div>

    <CommandPalette />
  </div>
</template>
