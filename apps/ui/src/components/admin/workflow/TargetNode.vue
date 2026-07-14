<script setup lang="ts">
/**
 * Routing-map node for one placed `workflow_targets` instance: a scene run,
 * or a device command with its own params. The subtitle shows *this
 * instance's* configured command, not just the device's generic type — the
 * whole point of allowing many instances of the same device is telling them
 * apart at a glance (e.g. two "Living Room Light" nodes, one showing "On",
 * the other "Off"). Click opens its inspector (`WorkflowTargetInspector`,
 * driven by the parent view's selection) rather than editing anything here.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { MonitorSpeakerIcon, SparklesIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'target' }>
  selected: boolean
}>()

const isScene = computed(() => props.data.target.targetType === 'scene.execute')
const icon = computed(() => (isScene.value ? SparklesIcon : MonitorSpeakerIcon))
const title = computed(() => (isScene.value ? (props.data.scene?.name ?? 'Unknown scene') : (props.data.device?.name ?? 'Unknown device')))
const subtitle = computed(() => (isScene.value ? 'Run scene' : (props.data.target.targetCommand ?? 'Pick a command…')))
</script>

<template>
  <div
    class="bg-card w-56 cursor-pointer rounded-lg border px-3 py-2.5 shadow-sm transition-colors"
    :class="[selected ? 'border-primary ring-primary/30 ring-2' : 'hover:border-primary/50']"
  >
    <div class="flex items-center gap-2">
      <component :is="icon" class="text-muted-foreground size-4 shrink-0" />
      <p class="truncate text-sm font-medium">{{ title }}</p>
    </div>
    <p class="text-muted-foreground mt-0.5 truncate text-xs">{{ subtitle }}</p>
    <Handle type="target" :position="Position.Left" />
  </div>
</template>
