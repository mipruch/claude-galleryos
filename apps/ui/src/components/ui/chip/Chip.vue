<script setup lang="ts">
/**
 * A small toggleable chip — rounded corners (not a pill), used for the device
 * grouping selector and type filter. `active` switches it to the filled style.
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ active?: boolean; class?: HTMLAttributes['class'] }>()
</script>

<template>
  <button
    type="button"
    :aria-pressed="active"
    :class="cn(
      'focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
      props.class,
    )"
  >
    <slot />
  </button>
</template>
