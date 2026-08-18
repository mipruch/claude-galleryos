<script setup lang="ts">
/**
 * A compact card in the stage board — a single scene action (device command
 * or sub-scene run), draggable within/between stage columns. Clicking it opens
 * the full field editor in the right-hand inspector (`SceneStepInspector`);
 * the card itself only shows enough to recognize the step at a glance,
 * including the device/scene "kind" tag the flat step list used to show
 * (borrowed here since the board's compact cards otherwise lose that cue).
 */
import { computed } from 'vue'
import { LinkIcon, SlidersHorizontalIcon } from '@lucide/vue'
import type { EditAction } from '@/lib/sceneActions'
import { isActionComplete } from '@/lib/sceneActions'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ action: EditAction; selected: boolean }>()

const devices = useDevicesStore()
const scenes = useScenesStore()

const isSubScene = computed(() => props.action.target === 'scene')
const complete = computed(() => isActionComplete(props.action))
const title = computed(() => {
  if (isSubScene.value) return scenes.records.find((s) => s.id === props.action.childSceneId)?.name ?? 'Pick a scene…'
  return devices.records.find((d) => d.id === props.action.deviceId)?.name ?? 'Pick a device…'
})
const subtitle = computed(() => {
  if (isSubScene.value) return isActionComplete(props.action) ? 'Run scene' : 'Pick a scene…'
  return props.action.command || 'Pick a command…'
})
</script>

<template>
  <div
    class="bg-card flex cursor-pointer flex-col gap-1.5 rounded-md border px-3 py-2.5 shadow-sm transition-colors"
    :class="selected ? 'border-brand ring-brand/30 ring-2' : 'hover:border-brand/50'"
  >
    <div class="flex items-center justify-between gap-2">
      <Badge :variant="isSubScene ? 'scene' : 'device'" class="text-[10px]">
        <component :is="isSubScene ? LinkIcon : SlidersHorizontalIcon" class="size-3" />
        {{ isSubScene ? 'Scene' : 'Device' }}
      </Badge>
    </div>
    <p class="truncate text-sm font-medium">{{ title }}</p>
    <p class="truncate text-xs" :class="complete ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'">
      {{ subtitle }}
    </p>
  </div>
</template>
