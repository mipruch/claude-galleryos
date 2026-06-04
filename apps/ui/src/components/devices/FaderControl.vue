<script setup lang="ts">
/**
 * Reusable fader: a horizontal slider with a percentage readout. Works in 0..1
 * externally (matches the drivers' `level` / `brightness`), 0..100 internally.
 * Shared by the light-brightness fader and the BSS audio fader.
 */
import { computed } from 'vue'
import { Slider } from '@/components/ui/slider'

const props = withDefaults(
  defineProps<{
    /** Current value, 0..1. */
    modelValue: number
    disabled?: boolean
    /** Visually grey-out the fader (muted / inactive) without blocking interaction. */
    dimmed?: boolean
  }>(),
  { disabled: false, dimmed: false },
)

const emit = defineEmits<{
  /** Live value while dragging, 0..1. */
  (e: 'update:modelValue', value: number): void
  /** Final value when the user releases, 0..1. */
  (e: 'commit', value: number): void
}>()

const percent = computed(() => Math.round(props.modelValue * 100))

function onUpdate(value: number[] | undefined): void {
  emit('update:modelValue', (value?.[0] ?? 0) / 100)
}

function onCommit(value: number[] | undefined): void {
  emit('commit', (value?.[0] ?? 0) / 100)
}
</script>

<template>
  <div class="flex items-center gap-3 transition-opacity" :class="{ 'opacity-50': dimmed }">
    <Slider
      :model-value="[percent]"
      :min="0"
      :max="100"
      :step="1"
      :disabled="disabled"
      class="flex-1"
      @update:model-value="onUpdate"
      @value-commit="onCommit"
    />
    <span class="text-muted-foreground w-10 text-right text-sm tabular-nums">
      {{ percent }}%
    </span>
  </div>
</template>
