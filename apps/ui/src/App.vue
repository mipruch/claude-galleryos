<script setup lang="ts">
/**
 * Global app shell. Owns the app-wide lifecycle shared by every route — the
 * single `/ws` socket and the initial store hydration — so the user panel and
 * the admin portal share one connection and one set of stores. Per-section
 * chrome (sidebars, headers) lives in the layout components the router mounts.
 *
 * Hydration only starts once `useAuthStore` has a logged-in user — reactively,
 * not just on mount, so it also fires right after a login (no page reload
 * involved). The kiosk viewer authenticates via its own PIN pad instead (no
 * `auth.user`), so it drives this same hydration itself — see KioskView.vue.
 */
import { onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import 'vue-sonner/style.css'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useInactivityLogout } from '@/composables/useInactivityLogout'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'
import { useRealtimeStore } from '@/stores/realtime'
import { useCamerasStore } from '@/stores/cameras'

const auth = useAuthStore()
const store = useDevicesStore()
const scenes = useScenesStore()
const realtime = useRealtimeStore()
const cameras = useCamerasStore()
const router = useRouter()

const DEFAULT_SESSION_TIMEOUT_MINUTES = 15

// Re-armed on every login (and torn down on logout) rather than started once,
// so re-authenticating as a different user always gets a fresh idle window.
let stopInactivityWatch: (() => void) | null = null

watch(
  () => auth.isAuthenticated,
  async (authenticated) => {
    stopInactivityWatch?.()
    stopInactivityWatch = null
    if (!authenticated) return
    realtime.open()
    store.init()
    scenes.fetchAll()
    cameras.fetchAll()
    const security = await api.settings.security.get()
    stopInactivityWatch = useInactivityLogout(
      security?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
      () => {
        auth.logout()
        router.push({ name: 'login' })
      },
    )
  },
  { immediate: true },
)
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
