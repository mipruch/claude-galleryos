<script setup lang="ts">
/** Responsive grid of all renderable devices, mapped from the store. */
import { useDevicesStore } from '@/stores/devices'
import DeviceWidget from './DeviceWidget.vue'

const store = useDevicesStore()
</script>

<template>
  <div
    v-if="store.devices.length"
    class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
  >
    <DeviceWidget v-for="device in store.devices" :key="device.id" :device="device" />
  </div>

  <p v-else-if="store.loading" class="text-muted-foreground text-sm">Loading devices…</p>

  <p v-else class="text-muted-foreground text-sm">
    No devices to show. Make sure the server is running and seeded
    (<code class="text-foreground">bun run seed</code>).
  </p>
</template>
