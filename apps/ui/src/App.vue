<script setup lang="ts">
/**
 * Global app shell. Owns the app-wide lifecycle shared by every route — the
 * single `/ws` socket and the initial store hydration — so the user panel and
 * the admin portal share one connection and one set of stores. Per-section
 * chrome (sidebars, headers) lives in the layout components the router mounts.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import 'vue-sonner/style.css'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'
import { useRealtimeStore } from '@/stores/realtime'

const store = useDevicesStore()
const scenes = useScenesStore()
const realtime = useRealtimeStore()

onMounted(() => {
  realtime.open()
  store.init()
  scenes.fetchAll()
})
onBeforeUnmount(() => realtime.close())
</script>

<template>
  <TooltipProvider>
    <div class="bg-background text-foreground min-h-screen">
      <RouterView />
    </div>
    <Toaster />
  </TooltipProvider>
</template>
