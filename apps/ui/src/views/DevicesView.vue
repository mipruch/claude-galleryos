<script setup lang="ts">
/**
 * The device page — used for both the home (all devices) and per-room routes.
 * The room scope itself is set from the route in `App.vue`; this view just
 * renders the (scope-aware) toolbar and grid.
 */
import DeviceToolbar from '@/components/devices/DeviceToolbar.vue'
import DeviceGrid from '@/components/devices/DeviceGrid.vue'
</script>

<template>
  <DeviceToolbar />
  <DeviceGrid />
</template>
