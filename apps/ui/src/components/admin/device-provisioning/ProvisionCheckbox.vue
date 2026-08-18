<script setup lang="ts">
/**
 * The review sheet's checkbox — a brand-coloured tick, matching the accent the
 * scene editor established (`--brand`). It's local to the provisioning flow
 * rather than a new `ui/checkbox` primitive because it is the only checkbox in
 * the app: everything else that toggles is a `Switch`.
 *
 * `indeterminate` renders the partial-selection dash the header checkbox needs
 * when some (but not all) rows are selected.
 */
import { CheckIcon, MinusIcon } from '@lucide/vue'

defineProps<{
  modelValue: boolean
  indeterminate?: boolean
  disabled?: boolean
  label: string
}>()

const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : modelValue"
    :aria-label="label"
    :disabled="disabled"
    class="focus-visible:ring-ring/50 flex size-5 shrink-0 items-center justify-center rounded-[5px] border transition-colors focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    :class="
      modelValue || indeterminate
        ? 'bg-brand border-brand text-brand-foreground'
        : 'border-input bg-background hover:border-brand/60'
    "
    @click="emit('update:modelValue', !modelValue)"
  >
    <MinusIcon v-if="indeterminate && !modelValue" class="size-3.5" />
    <CheckIcon v-else-if="modelValue" class="size-3.5" />
  </button>
</template>
