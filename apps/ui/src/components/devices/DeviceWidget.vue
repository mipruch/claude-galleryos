<script setup lang="ts">
/** Picks the right control widget for a device based on its kind. */
import { computed } from 'vue'
import { deviceKind, type DeviceRecord } from '@/lib/devices'
import LightFaderWidget from './LightFaderWidget.vue'
import BssFaderWidget from './BssFaderWidget.vue'
import SwitchWidget from './SwitchWidget.vue'

const props = defineProps<{ device: DeviceRecord }>()

const widget = computed(() => {
  switch (deviceKind(props.device)) {
    case 'lightFader':
      return LightFaderWidget
    case 'bssFader':
    case 'bssMatrix':  // same widget, different semantics detected internally
      return BssFaderWidget
    case 'switch':
      return SwitchWidget
    default:
      return null
  }
})
</script>

<template>
  <component :is="widget" v-if="widget" :device="device" />
</template>
