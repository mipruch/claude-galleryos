<script setup lang="ts">
/**
 * Routing-map card for one placed `workflow_targets` instance: a scene run,
 * or a device command with its own params. The subtitle "Command" row shows
 * *this instance's* configured command, not just the device's generic type —
 * the whole point of allowing many instances of the same device is telling
 * them apart at a glance (e.g. two "Living Room Light" cards, one showing
 * "on", the other "off"). A device instance with no command picked yet reads
 * as amber/"NEEDS COMMAND" (the same incomplete-state colour the scene editor's
 * step cards use), which is also what the toolbar's "N unfinished" count
 * tallies. Click opens its inspector (`WorkflowTargetInspector`, driven by
 * the parent view's selection) rather than editing anything here.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { MonitorSpeakerIcon, SparklesIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'target' }>
  selected: boolean
}>()

const isScene = computed(() => props.data.target.targetType === 'scene.execute')
const icon = computed(() => (isScene.value ? SparklesIcon : MonitorSpeakerIcon))
const title = computed(() => (isScene.value ? (props.data.scene?.name ?? 'Unknown scene') : (props.data.device?.name ?? 'Unknown device')))
const needsCommand = computed(() => !isScene.value && !props.data.target.targetCommand)
const commandValue = computed(() => (isScene.value ? 'Run scene' : (props.data.target.targetCommand ?? 'Pick a command…')))
</script>

<template>
  <div
    class="bg-card w-72 cursor-pointer rounded-xl border px-3.5 py-3 shadow-sm transition-colors"
    :class="selected ? 'border-brand ring-brand/30 ring-2' : 'hover:border-brand/50'"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Action</p>
      <Badge v-if="needsCommand" variant="warning" class="text-[10px] tracking-wide uppercase">Needs command</Badge>
      <Badge v-else :variant="isScene ? 'scene' : 'command'" class="text-[10px] tracking-wide uppercase">
        <component :is="icon" class="size-3" />
        {{ isScene ? 'Scene' : 'Device' }}
      </Badge>
    </div>
    <p class="mt-1.5 truncate text-sm font-semibold">{{ title }}</p>
    <div class="mt-1.5 flex items-center justify-between gap-2 text-xs">
      <span class="text-muted-foreground">Command</span>
      <span :class="needsCommand ? 'text-amber-600 dark:text-amber-400' : 'font-medium'">{{ commandValue }}</span>
    </div>
    <Handle type="target" :position="Position.Left" />
  </div>
</template>
