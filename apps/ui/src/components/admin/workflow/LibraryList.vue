<script setup lang="ts">
/**
 * One kind's section of the library panel (scenes, or devices): a title, an
 * empty-state line, and a draggable card per item. Split out of
 * `LibraryPanel.vue` so its two near-identical sections (only the kind, icon,
 * and copy differ) share one template instead of being duplicated.
 */
import type { Component } from 'vue'
import { setLibraryDragPayload, type LibraryDragPayload } from '@/lib/libraryDrag'

defineProps<{
  kind: LibraryDragPayload['kind']
  title: string
  emptyText: string
  items: ReadonlyArray<{ id: string; name: string }>
  icon: Component
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <p class="text-muted-foreground text-xs font-medium tracking-wide uppercase">{{ title }}</p>
    <p v-if="!items.length" class="text-muted-foreground text-xs">{{ emptyText }}</p>
    <div
      v-for="item in items"
      :key="item.id"
      class="bg-card flex cursor-grab items-center gap-2 rounded-md border px-2.5 py-2 text-sm shadow-sm active:cursor-grabbing hover:border-primary/50"
      draggable="true"
      @dragstart="setLibraryDragPayload($event, { kind, id: item.id })"
    >
      <component :is="icon" class="text-muted-foreground size-4 shrink-0" />
      <span class="truncate">{{ item.name }}</span>
    </div>
  </div>
</template>
