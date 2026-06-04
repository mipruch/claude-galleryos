<script setup lang="ts">
/**
 * Controls above the device grid: a row of chips to group the grid (Off / Room /
 * Type) and a row of chips to filter by device type (multi-select; none = all).
 */
import { Chip } from '@/components/ui/chip'
import { typeLabel, type GroupMode } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const store = useDevicesStore()

const groupOptions: { mode: GroupMode; label: string }[] = [
  { mode: 'off', label: 'Off' },
  { mode: 'room', label: 'Room' },
  { mode: 'type', label: 'Type' },
]
</script>

<template>
  <div v-if="store.devices.length" class="mb-6 space-y-3">
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

    <!-- Type filter -->
    <div v-if="store.deviceTypes.length > 1" class="flex flex-wrap items-center gap-2">
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

    <!-- Room filter -->
    <div v-if="store.roomOptions.length > 1" class="flex flex-wrap items-center gap-2">
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
</template>
