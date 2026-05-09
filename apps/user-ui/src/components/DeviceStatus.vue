<script setup lang="ts">
import { computed } from 'vue';
import { useGalleryStore } from '../store';

const props = defineProps<{ deviceId: string }>();
const store = useGalleryStore();
const device = computed(() => store.devices[props.deviceId]);
const state = computed(() => store.deviceStates[props.deviceId] ?? {});
const online = computed(() => store.deviceOnline[props.deviceId] !== false);
</script>

<template>
  <div v-if="device" class="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
    <div>
      <p class="font-medium">{{ device.name }}</p>
      <p class="text-xs text-slate-400">
        {{ online ? 'online' : 'offline' }}
        <span v-if="typeof state.level === 'number'"> · {{ Math.round(state.level * 100) }}%</span>
        <span v-if="state.state"> · {{ state.state }}</span>
      </p>
    </div>
    <span class="w-3 h-3 rounded-full" :class="online ? 'bg-green-500' : 'bg-red-500'"></span>
  </div>
</template>
