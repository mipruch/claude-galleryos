<script setup lang="ts">
/**
 * Scene-canvas header node: either the "Scene start" anchor or a stage
 * column's header (its `parallelGroup`, shown as a 1-based "Stage N" plus how
 * many actions in it run in parallel). Not draggable/connectable — it's a
 * label for the column, not something the user repositions or wires up.
 */
import { computed } from 'vue'
import { FlagIcon, LayersIcon } from '@lucide/vue'
import type { StageGraphNodeData } from '@/lib/workflowGraph'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ data: Extract<StageGraphNodeData, { kind: 'start' | 'stage' }> }>()

const stage = computed(() => (props.data.kind === 'stage' ? props.data : null))
</script>

<template>
  <div class="bg-muted/60 flex w-56 items-center gap-2 rounded-full border px-3 py-1.5">
    <component :is="stage ? LayersIcon : FlagIcon" class="text-muted-foreground size-3.5 shrink-0" />
    <p class="text-muted-foreground truncate text-xs font-semibold tracking-wide uppercase">
      {{ stage ? `Stage ${stage.groupIndex + 1}` : 'Scene start' }}
    </p>
    <Badge v-if="stage" variant="secondary" class="ml-auto shrink-0 text-[10px]">
      {{ stage.count }} parallel
    </Badge>
  </div>
</template>
