<script setup lang="ts">
/**
 * Minimal left navigation: "All devices" (home) plus one entry per room, each
 * showing its device count. Routes drive the page scope, so these are plain
 * router links — refreshing keeps you on the same page.
 *
 * Below `md:` this becomes an off-canvas drawer (fixed, slid off-screen via
 * `-translate-x-full`) toggled by the header's hamburger button — see
 * `composables/useSidebar.ts`. At `md:` and up the drawer state is ignored;
 * CSS alone forces it back into the static, always-visible layout.
 */
import { computed } from 'vue'
import {
  LayoutGridIcon,
  DoorOpenIcon,
  CalendarClockIcon,
  VideoIcon,
  UserCog,
  LogOutIcon,
  XIcon,
} from '@lucide/vue'
import { useDevicesStore } from '@/stores/devices'
import { useCamerasStore } from '@/stores/cameras'
import { useAuthStore } from '@/stores/auth'
import { useSidebar } from '@/composables/useSidebar'
import { useRouter } from 'vue-router'
const router = useRouter()
const auth = useAuthStore()
const store = useDevicesStore()
const camerasStore = useCamerasStore()
const { open, close } = useSidebar()

function logout(): void {
  auth.logout()
  router.push({ name: 'login' })
}

/** Follow the router link, then close the drawer (a no-op at `md:` and up). */
function onNavigate(navigate: (e?: MouseEvent) => void, event?: MouseEvent): void {
  navigate(event)
  close()
}

const rooms = computed(() =>
  [...store.rooms].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
)

const iframes = computed(() => store.iframes)
// Disabled cameras are admin-only (managed under /admin/cameras) — the server
// also 404s a stream request for one, so keep them out of the sidebar too.
const cameras = computed(() => camerasStore.records.filter((c) => c.enabled))

function linkClass(isActive: boolean): string {
  return [
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors outline-none',
    'focus-visible:ring-ring focus-visible:ring-2',
    isActive
      ? 'bg-accent text-foreground font-medium'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  ].join(' ')
}
</script>

<template>
  <!-- Backdrop — mobile only; closes the drawer on tap. -->
  <div
    v-if="open"
    class="fixed inset-0 z-40 bg-black/50 md:hidden"
    aria-hidden="true"
    @click="close"
  />

  <aside
    class="bg-background fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 -translate-x-full flex-col border-r transition-transform duration-200 ease-in-out md:static md:z-auto md:translate-x-0"
    :class="{ 'translate-x-0': open }"
  >
    <div class="flex items-center justify-between gap-2 border-b px-4 py-4">
      <div class="min-w-0">
        <h1 class="text-lg font-semibold tracking-tight">GalleryOS</h1>
        <p class="text-muted-foreground text-xs">Device control</p>
      </div>
      <button
        type="button"
        class="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring shrink-0 rounded-md p-1.5 outline-none focus-visible:ring-2 md:hidden"
        aria-label="Close menu"
        @click="close"
      >
        <XIcon class="size-5" />
      </button>
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
      <RouterLink to="/" custom v-slot="{ href, navigate, isExactActive }">
        <a :href="href" :class="linkClass(isExactActive)" @click="onNavigate(navigate, $event)">
          <LayoutGridIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate">All devices</span>
          <span class="text-xs opacity-60">{{ store.devices.length }}</span>
        </a>
      </RouterLink>

      <RouterLink to="/schedules" custom v-slot="{ href, navigate, isActive }">
        <a :href="href" :class="linkClass(isActive)" @click="onNavigate(navigate, $event)">
          <CalendarClockIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate">Schedules</span>
        </a>
      </RouterLink>

      <p
        v-if="rooms.length"
        class="text-muted-foreground px-3 pt-4 pb-1 text-xs font-medium tracking-wide uppercase"
      >
        Rooms
      </p>
      <RouterLink
        v-for="room in rooms"
        :key="room.id"
        :to="`/rooms/${room.id}`"
        custom
        v-slot="{ href, navigate, isActive }"
      >
        <a :href="href" :class="linkClass(isActive)" @click="onNavigate(navigate, $event)">
          <DoorOpenIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate">{{ room.name }}</span>
          <span class="text-xs opacity-60">{{ store.roomDeviceCounts[room.id] ?? 0 }}</span>
        </a>
      </RouterLink>

      <template v-if="cameras.length">
        <p class="text-muted-foreground px-3 pt-4 pb-1 text-xs font-medium tracking-wide uppercase">
          Cameras
        </p>
        <RouterLink
          v-for="camera in cameras"
          :key="camera.id"
          :to="`/cameras/${camera.id}`"
          custom
          v-slot="{ href, navigate, isActive }"
        >
          <a :href="href" :class="linkClass(isActive)" @click="onNavigate(navigate, $event)">
            <VideoIcon class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ camera.name }}</span>
          </a>
        </RouterLink>
      </template>

      <template v-if="iframes.length">
        <p class="text-muted-foreground px-3 pt-4 pb-1 text-xs font-medium tracking-wide uppercase">
          Views
        </p>
        <RouterLink
          v-for="iframe in iframes"
          :key="iframe.id"
          :to="`/iframes/${iframe.id}`"
          custom
          v-slot="{ href, navigate, isActive }"
        >
          <a :href="href" :class="linkClass(isActive)" @click="onNavigate(navigate, $event)">
            <span class="flex-1 truncate">{{ iframe.name }}</span>
          </a>
        </RouterLink>
      </template>
    </nav>

    <div class="border-t p-2">
      <RouterLink to="/admin" custom v-slot="{ href, navigate }" v-if="auth.role?.isAdmin">
        <a :href="href" :class="linkClass(false)" @click="onNavigate(navigate, $event)">
          <UserCog class="size-4 shrink-0" />
          <span class="flex-1 truncate">Admin panel</span>
        </a>
      </RouterLink>

      <button
        type="button"
        :class="linkClass(false)"
        class="w-full cursor-pointer"
        @click="logout"
        :aria-label="`Log out (${auth.user?.username})`"
      >
        <LogOutIcon class="size-4 shrink-0" />
        <span class="flex-1 truncate text-left"
          >Log out{{ auth.user ? ` (${auth.user.username})` : '' }}</span
        >
      </button>
    </div>
  </aside>
</template>
