<script setup lang="ts">
/**
 * Renders the device groups from the store. With grouping off there is a single
 * untitled group + subgroup (a plain grid). Grouped by room/type, each group has
 * a heading and is further split into subgroups (type within room, or room within
 * type), each subgroup with its own subheading above its grid. Empty groups and
 * subgroups are never emitted by the store, so nothing renders for them.
 */
import type { DeviceGroup } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'
import DeviceWidget from './DeviceWidget.vue'

const store = useDevicesStore()

const groupCount = (group: DeviceGroup): number =>
  group.subgroups.reduce((n, sub) => n + sub.devices.length, 0)
</script>

<template>
  <div v-if="store.filteredDevices.length" class="space-y-10">
    <section v-for="group in store.groups" :key="group.key">
      <h2
        v-if="group.title"
        class="mb-4 flex items-baseline gap-2 text-base font-semibold tracking-tight"
      >
        {{ group.title }}
        <span class="text-muted-foreground text-xs font-normal">{{ groupCount(group) }}</span>
      </h2>

      <div class="space-y-6">
        <div v-for="sub in group.subgroups" :key="sub.key">
          <h3
            v-if="sub.title"
            class="text-muted-foreground mb-2 flex items-baseline gap-2 text-xs font-medium tracking-wide uppercase"
          >
            {{ sub.title }}
            <span class="font-normal normal-case">{{ sub.devices.length }}</span>
          </h3>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DeviceWidget v-for="device in sub.devices" :key="device.id" :device="device" />
          </div>
        </div>
      </div>
    </section>
  </div>

  <p v-else-if="store.loading" class="text-muted-foreground text-sm">Loading devices…</p>

  <p v-else-if="store.devices.length" class="text-muted-foreground text-sm">
    {{ store.searching ? 'No devices match your search.' : 'No devices match the selected filters.' }}
  </p>

  <p v-else class="text-muted-foreground text-sm">
    No devices to show. Make sure the server is running and seeded
    (<code class="text-foreground">bun run seed</code>).
  </p>
</template>
