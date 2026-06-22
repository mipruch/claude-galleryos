<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { Separator, type SeparatorProps } from "reka-ui"
import { cn } from "@/lib/utils"

const props = withDefaults(
  defineProps<SeparatorProps & { class?: HTMLAttributes["class"] }>(),
  { orientation: "horizontal", decorative: true },
)
</script>

<template>
  <Separator
    data-slot="separator"
    :orientation="props.orientation"
    :decorative="props.decorative"
    :class="
      cn(
        'bg-border shrink-0',
        props.orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
        props.class,
      )
    "
  />
</template>
