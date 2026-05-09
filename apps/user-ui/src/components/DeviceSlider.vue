<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useGalleryStore } from '../store';

const props = defineProps<{ deviceId: string }>();
const store = useGalleryStore();
const device = computed(() => store.devices[props.deviceId]);
const liveLevel = computed<number>(() => {
  const s = store.deviceStates[props.deviceId];
  return typeof s?.level === 'number' ? s.level : 0;
});

const localLevel = ref(0);
let dragging = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

watch(liveLevel, (v) => {
  if (!dragging) localLevel.value = v;
}, { immediate: true });

function onInput(e: Event) {
  dragging = true;
  localLevel.value = Number((e.target as HTMLInputElement).value);
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    store.deviceCommand(props.deviceId, 'setLevel', { level: localLevel.value });
    dragging = false;
  }, 80);
}
</script>

<template>
  <div v-if="device" class="bg-slate-800 rounded-xl p-4">
    <div class="flex items-center justify-between mb-2">
      <span class="font-medium">{{ device.name }}</span>
      <span class="text-sm text-slate-400">{{ Math.round(localLevel * 100) }}%</span>
    </div>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      :value="localLevel"
      @input="onInput"
      class="w-full"
    />
  </div>
</template>
