<script setup lang="ts">
/**
 * A "+" button rendered directly on a canvas — the scene stage canvas (end of
 * the stage row, or under an existing stage's actions) and the routing map
 * (trailing a trigger, to add a new trigger action). Purely presentational:
 * the parent view's node-click handler does the actual work, same as every
 * other node here — only `data.kind` decides the label, the rest of each
 * shape exists for the parent to read off the clicked node's id/data.
 */
import { PlusIcon } from '@lucide/vue'

defineProps<{
  data:
    | { kind: 'add-stage' }
    | { kind: 'add-action'; groupIndex: number }
    | { kind: 'add-action'; ownerKind: 'mapping' | 'schedule'; ownerId: string }
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
