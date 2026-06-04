<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { WifiIcon, WifiOffIcon } from '@lucide/vue'
import 'vue-sonner/style.css'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import DeviceGrid from '@/components/devices/DeviceGrid.vue'
import { useDevicesStore } from '@/stores/devices'

const store = useDevicesStore()

onMounted(() => store.init())
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
          <span
            class="flex items-center gap-1.5 text-xs"
            :class="store.connected ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'"
          >
            <component :is="store.connected ? WifiIcon : WifiOffIcon" class="size-4" />
            {{ store.connected ? 'Live' : 'Offline' }}
          </span>
        </header>

        <DeviceGrid />
      </main>

      <Toaster />
    </div>
  </TooltipProvider>
</template>
