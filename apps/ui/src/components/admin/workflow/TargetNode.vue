<script setup lang="ts">
/**
 * Routing-map node for what a trigger action resolves to: a scene or a device.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { MonitorSpeakerIcon, SparklesIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'scene' | 'device' }>
  selected: boolean
}>()

const icon = computed(() => (props.data.kind === 'scene' ? SparklesIcon : MonitorSpeakerIcon))
const title = computed(() => (props.data.kind === 'scene' ? props.data.scene.name : props.data.device.name))
const subtitle = computed(() =>
  props.data.kind === 'scene' ? 'Scene · click to open its steps' : (props.data.device.subtype ?? props.data.device.type),
)
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
    <Handle type="target" :position="Position.Left" />
  </div>
</template>
