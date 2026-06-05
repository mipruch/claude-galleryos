<script setup lang="ts">
/**
 * Controls above the device grid: chips to group the grid (Off / Room / Type)
 * and to filter by type / room, plus a search box on the right. A non-blank
 * search bypasses the chip filters and matches across all enabled devices, so
 * the (now inert) type/room filter rows are hidden while searching.
 */
import { computed } from 'vue'
import { SearchIcon, XIcon } from '@lucide/vue'
import { Chip } from '@/components/ui/chip'
import { typeLabel, type GroupMode } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const store = useDevicesStore()

const allGroupOptions: { mode: GroupMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'room', label: 'Room' },
  { mode: 'type', label: 'Type' },
]
// On a room page, grouping/filtering by room is meaningless — drop those.
const groupOptions = computed(() =>
  store.roomScope ? allGroupOptions.filter((o) => o.mode !== 'room') : allGroupOptions,
)
</script>

<template>
  <div v-if="store.scopedDevices.length" class="mb-6 flex flex-wrap items-start justify-between gap-3">
    <!-- Grouping + filters -->
    <div class="space-y-3">
      <!-- Grouping -->
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground mr-1 text-xs font-medium tracking-wide uppercase">
          Group
        </span>
        <Chip
          v-for="opt in groupOptions"
          :key="opt.mode"
          :active="store.groupMode === opt.mode"
          @click="store.setGroupMode(opt.mode)"
        >
          {{ opt.label }}
        </Chip>
      </div>

      <!-- Type filter (inert while searching) -->
      <div
        v-if="!store.searching && store.deviceTypes.length > 1"
        class="flex flex-wrap items-center gap-2"
      >
        <span class="text-muted-foreground mr-1 text-xs font-medium tracking-wide uppercase">
          Type
        </span>
        <Chip
          v-for="type in store.deviceTypes"
          :key="type"
          :active="store.typeFilter.includes(type)"
          @click="store.toggleType(type)"
        >
          {{ typeLabel(type) }}
          <span class="text-xs opacity-60">{{ store.typeCounts[type] }}</span>
        </Chip>
        <button
          v-if="store.typeFilter.length"
          type="button"
          class="text-muted-foreground hover:text-foreground ml-1 text-xs underline underline-offset-2"
          @click="store.clearTypeFilter()"
        >
          Clear
        </button>
      </div>

      <!-- Room filter (inert while searching) -->
      <div
        v-if="!store.searching && store.roomOptions.length > 1"
        class="flex flex-wrap items-center gap-2"
      >
        <span class="text-muted-foreground mr-1 text-xs font-medium tracking-wide uppercase">
          Room
        </span>
        <Chip
          v-for="room in store.roomOptions"
          :key="room.key"
          :active="store.roomFilter.includes(room.key)"
          @click="store.toggleRoom(room.key)"
        >
          {{ room.name }}
          <span class="text-xs opacity-60">{{ room.count }}</span>
        </Chip>
        <button
          v-if="store.roomFilter.length"
          type="button"
          class="text-muted-foreground hover:text-foreground ml-1 text-xs underline underline-offset-2"
          @click="store.clearRoomFilter()"
        >
          Clear
        </button>
      </div>
    </div>

    <!-- Search -->
    <div class="relative w-full sm:w-64">
      <SearchIcon
        class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
      />
      <input
        v-model="store.search"
        type="text"
        placeholder="Search devices…"
        aria-label="Search devices"
        class="border-input bg-background focus-visible:ring-ring placeholder:text-muted-foreground h-9 w-full rounded-md border px-8 text-sm outline-none focus-visible:ring-2"
      />
      <button
        v-if="store.search"
        type="button"
        aria-label="Clear search"
        class="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
        @click="store.search = ''"
      >
        <XIcon class="size-4" />
      </button>
    </div>
  </div>
</template>
