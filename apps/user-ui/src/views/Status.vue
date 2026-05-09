<script setup lang="ts">
import { computed } from 'vue';
import { useGalleryStore } from '../store';

const store = useGalleryStore();
const offlineDevices = computed(() =>
  Object.values(store.devices).filter((d: any) => store.deviceOnline[d.id] === false)
);
const runningScenes = computed(() =>
  Object.entries(store.sceneStatus)
    .filter(([, s]) => s === 'executing')
    .map(([id]) => store.scenes[id])
);
</script>

<template>
  <div class="max-w-2xl mx-auto p-4 space-y-4">
    <h2 class="text-2xl font-bold">Stav</h2>
    <div class="bg-slate-800 rounded-xl p-4">
      <h3 class="font-semibold mb-2">Aktivní scény</h3>
      <p v-if="runningScenes.length === 0" class="text-slate-500 text-sm">— žádné —</p>
      <ul v-else class="space-y-1">
        <li v-for="s in runningScenes" :key="s.id" class="text-blue-400">{{ s.name }}</li>
      </ul>
    </div>
    <div class="bg-slate-800 rounded-xl p-4">
      <h3 class="font-semibold mb-2">Zařízení offline</h3>
      <p v-if="offlineDevices.length === 0" class="text-slate-500 text-sm">— vše online —</p>
      <ul v-else class="space-y-1">
        <li v-for="d in offlineDevices" :key="d.id" class="text-red-400">{{ d.name }}</li>
      </ul>
    </div>
  </div>
</template>
