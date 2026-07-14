<script setup lang="ts">
/**
 * Left sidebar of the workflow routing map: scenes/devices not yet placed on
 * the canvas (see `unplacedLibraryItems`), as draggable cards. Dropping one
 * onto the canvas gives it a `position`, which is what makes it appear there
 * as a wireable target — see `WorkflowsView`'s drop handler.
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
