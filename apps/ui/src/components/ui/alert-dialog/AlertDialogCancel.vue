<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { AlertDialogCancel, type AlertDialogCancelProps } from "reka-ui"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const props = defineProps<AlertDialogCancelProps & { class?: HTMLAttributes["class"] }>()
</script>

<template>
  <AlertDialogCancel :as-child="props.asChild" :class="cn(buttonVariants({ variant: 'outline' }), props.class)">
    <slot />
  </AlertDialogCancel>
</template>
