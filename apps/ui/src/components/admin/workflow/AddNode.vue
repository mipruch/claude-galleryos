<script setup lang="ts">
/**
 * A "+" button rendered directly on the scene stage canvas — end of the stage
 * row (add a new trailing stage), or under an existing stage's actions (add
 * an action into that stage). Purely presentational: the parent view's
 * node-click handler does the actual work, same as every other node here —
 * only `data.kind` decides the label, the rest of each shape exists for the
 * parent to read off the clicked node's id/data.
 */
import { PlusIcon } from '@lucide/vue'

defineProps<{
  data: { kind: 'add-stage' } | { kind: 'add-action'; groupIndex: number }
}>()
</script>

<template>
  <div
    class="border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 flex size-10 cursor-pointer items-center justify-center rounded-md border-2 border-dashed transition-colors"
    :aria-label="data.kind === 'add-stage' ? 'Add stage' : 'Add action'"
  >
    <PlusIcon class="size-5" />
  </div>
</template>
