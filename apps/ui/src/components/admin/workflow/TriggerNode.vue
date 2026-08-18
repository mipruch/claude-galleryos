<script setup lang="ts">
/**
 * Routing-map card for a trigger (an input mapping or a CRON schedule).
 * Purely presentational — the parent canvas view owns click/connect/context-menu
 * behaviour. The header badge reads as one of the canvas legend's colours
 * (`Badge` `variant="ingress"`/`"cron"`) so a card's kind is legible before
 * reading a word of copy — except when `connected` is false, where it always
 * shows a neutral "NOT CONNECTED" badge instead: a trigger nothing is wired
 * from does nothing, regardless of its own kind.
 */
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { CalendarClockIcon, WaypointsIcon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'
import { protocolLabel } from '@/lib/mappings'
import { describeCron } from '@/lib/cron'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{
  data: Extract<RoutingNodeData, { kind: 'mapping' | 'schedule' }>
  selected: boolean
  /** Whether at least one trigger-action wire fans out of this node. */
  connected: boolean
}>()

const isMapping = computed(() => props.data.kind === 'mapping')
const title = computed(() => (props.data.kind === 'mapping' ? props.data.mapping.name : props.data.schedule.name))
const enabled = computed(() => (props.data.kind === 'mapping' ? props.data.mapping.enabled : props.data.schedule.enabled))

const typeBadgeLabel = computed(() =>
  props.data.kind === 'mapping' ? `${protocolLabel(props.data.mapping.protocol)} · INGRESS` : 'CRON',
)
const typeBadgeVariant = computed(() => (props.data.kind === 'mapping' ? 'ingress' : 'cron'))

const subtitlePrimary = computed(() => (props.data.kind === 'mapping' ? props.data.mapping.pattern : props.data.schedule.cron))
const subtitleSecondary = computed(() => (props.data.kind === 'schedule' ? describeCron(props.data.schedule.cron) : ''))
</script>

<template>
  <div
    class="bg-card w-72 cursor-pointer rounded-xl border px-3.5 py-3 shadow-sm transition-colors"
    :class="[
      selected ? 'border-brand ring-brand/30 ring-2' : 'hover:border-brand/50',
      !enabled && 'opacity-50',
      !connected && 'border-dashed',
    ]"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">Trigger</p>
      <Badge v-if="!connected" variant="warning" class="text-[10px] tracking-wide uppercase">Not connected</Badge>
      <Badge v-else :variant="typeBadgeVariant" class="text-[10px] tracking-wide uppercase">
        <component :is="isMapping ? WaypointsIcon : CalendarClockIcon" class="size-3" />
        {{ typeBadgeLabel }}
      </Badge>
    </div>
    <p class="mt-1.5 truncate text-sm font-semibold">{{ title }}</p>
    <p class="text-muted-foreground mt-0.5 truncate text-xs">
      <span class="font-mono">{{ subtitlePrimary }}</span>
      <span v-if="subtitleSecondary" class="ml-1.5">{{ subtitleSecondary }}</span>
    </p>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
