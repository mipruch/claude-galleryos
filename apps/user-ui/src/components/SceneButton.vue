<script setup lang="ts">
import { computed } from 'vue';
import { useGalleryStore } from '../store';

const props = defineProps<{ sceneId: string; size?: string }>();
const store = useGalleryStore();
const scene = computed(() => store.scenes[props.sceneId]);
const status = computed(() => store.sceneStatus[props.sceneId] ?? 'idle');

function click() {
  if (status.value === 'executing') return;
  store.executeScene(props.sceneId);
}
</script>

<template>
  <button
    v-if="scene"
    @click="click"
    class="rounded-xl border-2 transition-all shadow-md flex flex-col items-center justify-center p-4 active:scale-95"
    :class="{
      'h-32': props.size === 'large',
      'h-20': props.size !== 'large',
      'bg-slate-800 border-slate-700': status === 'idle',
      'bg-blue-700 border-blue-500 animate-pulse': status === 'executing',
      'bg-green-700 border-green-500': status === 'active',
      'bg-red-700 border-red-500': status === 'failed',
    }"
    :style="scene.color && status === 'idle' ? `border-left: 6px solid ${scene.color}` : ''"
  >
    <span class="text-2xl">★</span>
    <span class="font-medium mt-1">{{ scene.name }}</span>
    <span v-if="status === 'executing'" class="text-xs mt-1">Spouštění...</span>
    <span v-else-if="status === 'active'" class="text-xs mt-1">✓ Hotovo</span>
  </button>
</template>
