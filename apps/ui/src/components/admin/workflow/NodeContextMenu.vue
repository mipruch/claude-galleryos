<script setup lang="ts">
/**
 * Shared right-click menu for a routing-map card (trigger or target) —
 * Duplicate / Unwire / Delete, the same three actions regardless of node
 * kind (the handlers passed in already dispatch per-kind internally, see
 * `WorkflowsView.vue`). Wraps whatever card is passed as its default slot;
 * `as-child` on the trigger merges the context-menu listener onto that
 * card's own root element instead of adding an extra wrapper `<div>`.
 */
import { CopyIcon, Trash2Icon, UnlinkIcon } from '@lucide/vue'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'

defineProps<{
  nodeId: string
  onDuplicate: (nodeId: string) => void
  onUnwire: (nodeId: string) => void
  onDelete: (nodeId: string) => void
}>()
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem @select="onDuplicate(nodeId)">
        <CopyIcon />
        Duplicate
      </ContextMenuItem>
      <ContextMenuItem @select="onUnwire(nodeId)">
        <UnlinkIcon />
        Unwire
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" @select="onDelete(nodeId)">
        <Trash2Icon />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
