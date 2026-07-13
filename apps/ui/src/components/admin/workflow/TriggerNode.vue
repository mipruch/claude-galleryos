<script setup lang="ts">
/**
 * Routing-map node for a trigger (an input mapping or a CRON schedule).
 * Purely presentational — the parent canvas view owns click/connect
 * behaviour (opening the matching existing Mapping/ScheduleFormDialog).
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { CalendarClockIcon, WaypointsIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'
import { protocolLabel } from '@/lib/mappings'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'mapping' | 'schedule' }>
  selected: boolean
}>()

const isMapping = computed(() => props.data.kind === 'mapping')
const title = computed(() => (props.data.kind === 'mapping' ? props.data.mapping.name : props.data.schedule.name))
const enabled = computed(() => (props.data.kind === 'mapping' ? props.data.mapping.enabled : props.data.schedule.enabled))
const subtitle = computed(() =>
  props.data.kind === 'mapping'
    ? `${protocolLabel(props.data.mapping.protocol)} · ${props.data.mapping.pattern}`
    : props.data.schedule.cron,
)
</script>

<template>
  <div
    class="bg-card w-56 cursor-pointer rounded-lg border px-3 py-2.5 shadow-sm transition-colors"
    :class="[selected ? 'border-primary ring-primary/30 ring-2' : 'hover:border-primary/50', !enabled && 'opacity-50']"
  >
    <div class="flex items-center gap-2">
      <component :is="isMapping ? WaypointsIcon : CalendarClockIcon" class="text-muted-foreground size-4 shrink-0" />
      <p class="truncate text-sm font-medium">{{ title }}</p>
      <Badge v-if="!enabled" variant="outline" class="ml-auto shrink-0 text-[10px]">Off</Badge>
    </div>
    <p class="text-muted-foreground mt-0.5 truncate font-mono text-xs">{{ subtitle }}</p>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
