<script setup lang="ts">
/**
 * Routing-map node for what a trigger resolves to: a scene, a device, or (for
 * `event.emit` mappings) a terminal "event" node — there's no shared row to
 * point at, so it renders as a dead end labelled with the mapping's own name.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { MonitorSpeakerIcon, SparklesIcon, ZapIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'scene' | 'device' | 'event' }>
  selected: boolean
}>()

const icon = computed(() => {
  if (props.data.kind === 'scene') return SparklesIcon
  if (props.data.kind === 'device') return MonitorSpeakerIcon
  return ZapIcon
})
const title = computed(() => {
  if (props.data.kind === 'scene') return props.data.scene.name
  if (props.data.kind === 'device') return props.data.device.name
  return `Event: ${props.data.mapping.name}`
})
const subtitle = computed(() => {
  if (props.data.kind === 'scene') return 'Scene · double-click to open its steps'
  if (props.data.kind === 'device') return props.data.device.subtype ?? props.data.device.type
  return 'Emitted on the event bus (no subscribers yet)'
})
const isScene = computed(() => props.data.kind === 'scene')
</script>

<template>
  <div
    class="bg-card w-56 rounded-lg border px-3 py-2.5 shadow-sm transition-colors"
    :class="[selected ? 'border-primary ring-primary/30 ring-2' : '', isScene && 'cursor-pointer hover:border-primary/50']"
  >
    <div class="flex items-center gap-2">
      <component :is="icon" class="text-muted-foreground size-4 shrink-0" />
      <p class="truncate text-sm font-medium">{{ title }}</p>
    </div>
    <p class="text-muted-foreground mt-0.5 truncate text-xs">{{ subtitle }}</p>
    <Handle v-if="data.kind !== 'event'" type="target" :position="Position.Left" />
  </div>
</template>
