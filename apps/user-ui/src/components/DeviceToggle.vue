<script setup lang="ts">
import { computed } from 'vue';
import { useGalleryStore } from '../store';

const props = defineProps<{ deviceId: string }>();
const store = useGalleryStore();
const device = computed(() => store.devices[props.deviceId]);
const state = computed(() => store.deviceStates[props.deviceId] ?? {});
const on = computed(() => state.value.state === 'on');

function toggle() {
  store.deviceCommand(props.deviceId, on.value ? 'off' : 'on', {});
}
</script>

<template>
  <button
    v-if="device"
    @click="toggle"
    class="bg-slate-800 rounded-xl p-4 flex items-center justify-between active:scale-95 transition-all"
  >
    <span class="font-medium">{{ device.name }}</span>
    <span
      class="px-3 py-1 rounded-full text-sm"
      :class="on ? 'bg-green-600 text-white' : 'bg-slate-600 text-slate-200'"
    >
      {{ on ? 'ON' : 'OFF' }}
    </span>
  </button>
</template>
