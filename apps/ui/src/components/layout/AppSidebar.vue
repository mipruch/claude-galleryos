<script setup lang="ts">
/**
 * Minimal left navigation: "All devices" (home) plus one entry per room, each
 * showing its device count. Routes drive the page scope, so these are plain
 * router links — refreshing keeps you on the same page.
 */
import { computed } from 'vue'
import { LayoutGridIcon, DoorOpenIcon } from '@lucide/vue'
import { useDevicesStore } from '@/stores/devices'

const store = useDevicesStore()

const rooms = computed(() =>
  [...store.rooms].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
)

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
  <aside class="bg-background flex w-56 shrink-0 flex-col border-r">
    <div class="border-b px-4 py-4">
      <h1 class="text-lg font-semibold tracking-tight">GalleryOS</h1>
      <p class="text-muted-foreground text-xs">Device control</p>
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
      <RouterLink to="/" custom v-slot="{ href, navigate, isExactActive }">
        <a :href="href" :class="linkClass(isExactActive)" @click="navigate">
          <LayoutGridIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate">All devices</span>
          <span class="text-xs opacity-60">{{ store.devices.length }}</span>
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
        <a :href="href" :class="linkClass(isActive)" @click="navigate">
          <DoorOpenIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate">{{ room.name }}</span>
          <span class="text-xs opacity-60">{{ store.roomDeviceCounts[room.id] ?? 0 }}</span>
        </a>
      </RouterLink>
    </nav>
  </aside>
</template>
