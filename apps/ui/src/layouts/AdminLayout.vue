<script setup lang="ts">
/**
 * Admin portal shell for the `/admin/**` routes: a full-nav sidebar plus a top
 * bar carrying the page title (from the route meta) and the same live/connection
 * indicators as the user panel. The inner `<RouterView/>` renders each admin page.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { WifiIcon, WifiOffIcon } from '@lucide/vue'
import AdminSidebar from '@/components/layout/AdminSidebar.vue'
import ConnectionStatus from '@/components/connections/ConnectionStatus.vue'
import { useRealtimeStore } from '@/stores/realtime'

const route = useRoute()
const realtime = useRealtimeStore()

const pageTitle = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : 'Admin'))
const pageSubtitle = computed(() =>
  typeof route.meta.subtitle === 'string' ? route.meta.subtitle : '',
)
</script>

<template>
  <div class="flex h-screen overflow-hidden flex-col">
    <div
      v-if="!realtime.connected"
      class="bg-destructive/10 text-destructive flex items-center justify-center gap-2 px-4 py-1.5 text-sm"
    >
      <WifiOffIcon class="size-4" />
      <span>Realtime connection lost — reconnecting…</span>
    </div>

    <div class="flex min-h-0 flex-1">
      <AdminSidebar />

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center justify-between gap-4 border-b px-6 py-4">
          <div class="min-w-0">
            <h2 class="truncate text-xl font-semibold tracking-tight">{{ pageTitle }}</h2>
            <p v-if="pageSubtitle" class="text-muted-foreground text-sm">{{ pageSubtitle }}</p>
          </div>
          <div class="flex items-center gap-2">
            <ConnectionStatus />
            <span
              class="flex items-center gap-1.5 text-xs"
              :class="realtime.connected ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'"
            >
              <component :is="realtime.connected ? WifiIcon : WifiOffIcon" class="size-4" />
              {{ realtime.connected ? 'Live' : 'Offline' }}
            </span>
          </div>
        </header>

        <main class="min-h-0 w-full flex-1 overflow-y-auto">
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>
