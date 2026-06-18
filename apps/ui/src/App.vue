<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { SearchIcon, WifiIcon, WifiOffIcon } from '@lucide/vue'
import 'vue-sonner/style.css'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import DeviceGrid from '@/components/devices/DeviceGrid.vue'
import DeviceToolbar from '@/components/devices/DeviceToolbar.vue'
import SceneBar from '@/components/scenes/SceneBar.vue'
import ConnectionStatus from '@/components/connections/ConnectionStatus.vue'
import CommandPalette from '@/components/command/CommandPalette.vue'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'
import { useCommandPalette } from '@/composables/useCommandPalette'

const store = useDevicesStore()
const scenes = useScenesStore()
const { openPalette } = useCommandPalette()

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
const shortcutHint = computed(() => (isMac ? '⌘K' : 'Ctrl K'))

onMounted(() => {
  store.init()
  scenes.fetchAll()
})
onBeforeUnmount(() => store.dispose())
</script>

<template>
  <TooltipProvider>
    <div class="bg-background text-foreground min-h-screen">
      <!-- Offline banner -->
      <div
        v-if="!store.connected"
        class="bg-destructive/10 text-destructive flex items-center justify-center gap-2 px-4 py-1.5 text-sm"
      >
        <WifiOffIcon class="size-4" />
        <span>Realtime connection lost — reconnecting…</span>
      </div>

      <main class="mx-auto max-w-5xl px-4 py-8">

        <header class="mb-6 flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">GalleryOS</h1>
            <p class="text-muted-foreground text-sm">Device control panel</p>
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

        <SceneBar />
        <DeviceToolbar />
        <DeviceGrid />
      </main>

      <CommandPalette />
      <Toaster />
    </div>
  </TooltipProvider>
</template>
