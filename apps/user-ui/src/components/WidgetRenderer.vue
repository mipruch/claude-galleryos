<script setup lang="ts">
import { computed } from 'vue';
import { useGalleryStore } from '../store';
import SceneButton from './SceneButton.vue';
import DeviceSlider from './DeviceSlider.vue';
import DeviceToggle from './DeviceToggle.vue';
import DeviceStatus from './DeviceStatus.vue';

const props = defineProps<{ widget: any }>();
const store = useGalleryStore();

const favoriteScenes = computed(() =>
  Object.values(store.scenes).filter((s: any) => s.is_favorite)
);
</script>

<template>
  <SceneButton
    v-if="widget.type === 'scene_button' && widget.scene_id"
    :sceneId="widget.scene_id"
    :size="widget.size"
  />
  <DeviceSlider
    v-else-if="widget.type === 'device_slider' && widget.device_id"
    :deviceId="widget.device_id"
  />
  <DeviceToggle
    v-else-if="widget.type === 'device_toggle' && widget.device_id"
    :deviceId="widget.device_id"
  />
  <DeviceStatus
    v-else-if="widget.type === 'device_status' && widget.device_id"
    :deviceId="widget.device_id"
  />
  <h2
    v-else-if="widget.type === 'room_header'"
    class="col-span-full text-xl font-semibold text-slate-300 mt-2"
  >
    {{ widget.label ?? 'Sekce' }}
  </h2>
  <div
    v-else-if="widget.type === 'favorites_row'"
    class="col-span-full flex gap-3 overflow-x-auto pb-2"
  >
    <div v-for="s in favoriteScenes" :key="s.id" class="min-w-[10rem]">
      <SceneButton :sceneId="s.id" />
    </div>
  </div>
  <div v-else-if="widget.type === 'spacer'" class="col-span-full h-4"></div>
</template>
