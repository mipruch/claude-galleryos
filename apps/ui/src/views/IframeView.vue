<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'

const route = useRoute()
const store = useDevicesStore()

const iframe = computed(() =>
  store.iframes.find((f) => f.id === route.params.iframeId),
)
</script>

<template>
  <div v-if="iframe" class="size-full">
    <iframe
      :src="iframe.url"
      :title="iframe.name"
      width="100%"
      height="100%"
      frameborder="0"
    />
  </div>
  <div v-else class="flex size-full items-center justify-center text-muted-foreground text-sm">
    View not found.
  </div>
</template>
