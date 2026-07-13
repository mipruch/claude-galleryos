<script setup lang="ts">
/**
 * Scene-canvas node for one action (device command or sub-scene). Compact
 * summary only — clicking it (handled by the parent view's node-click
 * listener) opens the full `SceneActionRow` editor in the side inspector.
 */
import { computed } from 'vue'
import { LinkIcon, SlidersHorizontalIcon } from '@lucide/vue'
import type { StageGraphNodeData } from '@/lib/workflowGraph'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'

const props = defineProps<{ data: Extract<StageGraphNodeData, { kind: 'action' }>; selected: boolean }>()

const devices = useDevicesStore()
const scenes = useScenesStore()

const isSubScene = computed(() => props.data.action.target === 'scene')
const title = computed(() => {
  const a = props.data.action
  if (isSubScene.value) return scenes.records.find((s) => s.id === a.childSceneId)?.name ?? 'Pick a scene…'
  return devices.records.find((d) => d.id === a.deviceId)?.name ?? 'Pick a device…'
})
const subtitle = computed(() => {
  const a = props.data.action
  return isSubScene.value ? 'Run sub-scene' : a.command || 'Pick a command…'
})
</script>

<template>
  <div
    class="bg-card w-56 cursor-pointer rounded-md border px-3 py-2 shadow-sm transition-colors"
    :class="selected ? 'border-primary ring-primary/30 ring-2' : 'hover:border-primary/50'"
  >
    <div class="flex items-center gap-2">
      <component :is="isSubScene ? LinkIcon : SlidersHorizontalIcon" class="text-muted-foreground size-4 shrink-0" />
      <p class="truncate text-sm font-medium">{{ title }}</p>
    </div>
    <p class="text-muted-foreground mt-0.5 truncate text-xs">{{ subtitle }}</p>
  </div>
</template>
