<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { AlertDialogAction, type AlertDialogActionProps } from "reka-ui"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const props = defineProps<AlertDialogActionProps & { class?: HTMLAttributes["class"] }>()
</script>

<template>
  <AlertDialogAction :as-child="props.asChild" :class="cn(buttonVariants(), props.class)">
    <slot />
  </AlertDialogAction>
</template>
