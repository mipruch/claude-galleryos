<script setup lang="ts">
/**
 * Renders the device groups from the store. With grouping off there is a single
 * untitled group (a plain grid); grouped by room/type, each group gets a heading
 * above its own grid.
 */
import { useDevicesStore } from '@/stores/devices'
import DeviceWidget from './DeviceWidget.vue'

const store = useDevicesStore()
</script>

<template>
  <div v-if="store.filteredDevices.length" class="space-y-8">
    <section v-for="group in store.groups" :key="group.key">
      <h2
        v-if="group.title"
        class="mb-3 flex items-baseline gap-2 text-sm font-semibold tracking-tight"
      >
        {{ group.title }}
        <span class="text-muted-foreground text-xs font-normal">{{ group.devices.length }}</span>
      </h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DeviceWidget v-for="device in group.devices" :key="device.id" :device="device" />
      </div>
    </section>
  </div>

  <p v-else-if="store.loading" class="text-muted-foreground text-sm">Loading devices…</p>

  <p v-else-if="store.devices.length" class="text-muted-foreground text-sm">
    No devices match the selected filter.
  </p>

  <p v-else class="text-muted-foreground text-sm">
    No devices to show. Make sure the server is running and seeded
    (<code class="text-foreground">bun run seed</code>).
  </p>
</template>
