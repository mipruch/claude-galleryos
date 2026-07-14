<script setup lang="ts">
/**
 * Left sidebar of the workflow routing map: every scene/device, as draggable
 * cards — the library never empties, since dropping one onto the canvas
 * always places a brand new `workflow_targets` instance (never "moves" an
 * existing one), so the same scene/device can be dropped again for a second,
 * independently-configured node. See `WorkflowsView`'s drop handler.
 */
import { MonitorSpeakerIcon, SparklesIcon } from '@lucide/vue'
import type { DeviceDTO, SceneDTO } from '@gallery/types'
import LibraryList from './LibraryList.vue'

defineProps<{ scenes: SceneDTO[]; devices: DeviceDTO[] }>()
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <p class="text-sm font-medium">Library</p>
      <p class="text-muted-foreground text-xs">Drag onto the canvas to place</p>
    </div>

    <LibraryList kind="scene" title="Scenes" empty-text="All scenes are on the canvas" :items="scenes" :icon="SparklesIcon" />
    <LibraryList kind="device" title="Devices" empty-text="All devices are on the canvas" :items="devices" :icon="MonitorSpeakerIcon" />
  </div>
</template>
