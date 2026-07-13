<script setup lang="ts">
/**
 * Routing-map node for one trigger action — what a mapping/schedule fires: a
 * scene run or a device command. Sits between its owning trigger and the
 * target it resolves to (or nothing yet, a normal "not wired" state rendered
 * dashed so it reads as in-progress rather than broken).
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { PlayCircleIcon, SlidersHorizontalIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { resolveTargetNames, targetSummary } from '@/lib/triggerActions'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'action' }>
  selected: boolean
}>()

const scenesStore = useScenesStore()
const devicesStore = useDevicesStore()

const action = computed(() => props.data.action)
const isScene = computed(() => action.value.targetType === 'scene.execute')
const wired = computed(() => !!action.value.targetId)
const summary = computed(() =>
  targetSummary(action.value.targetType, resolveTargetNames(action.value, scenesStore.records, devicesStore.records)),
)
</script>

<template>
  <div
    class="bg-card w-48 cursor-pointer rounded-lg border px-3 py-2 shadow-sm transition-colors"
    :class="[
      selected ? 'border-primary ring-primary/30 ring-2' : 'hover:border-primary/50',
      !wired && 'border-dashed opacity-70',
    ]"
  >
    <Handle type="target" :position="Position.Left" />
    <div class="flex items-center gap-2">
      <component :is="isScene ? PlayCircleIcon : SlidersHorizontalIcon" class="text-muted-foreground size-3.5 shrink-0" />
      <p class="truncate text-xs font-medium">{{ summary }}</p>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
