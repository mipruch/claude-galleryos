<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useFormField } from "./useFormField"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
const { error, formItemId } = useFormField()
</script>

<template>
  <Label
    data-slot="form-label"
    :data-invalid="!!error"
    :class="cn('data-[invalid=true]:text-destructive', props.class)"
    :for="formItemId"
  >
    <slot />
  </Label>
</template>
