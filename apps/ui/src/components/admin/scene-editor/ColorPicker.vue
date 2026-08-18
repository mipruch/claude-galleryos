<script setup lang="ts">
/**
 * A row of swatch buttons from the app's global colour palette (`lib/palette.ts`)
 * — the only way to set a scene's colour. No hex text entry anywhere: every
 * value this emits is one of `PALETTE_COLORS`, so `scene.color` always stays a
 * value the rest of the UI (`SceneBar`, this picker) recognizes.
 *
 * The selected swatch is marked by a ring in its own colour (via the
 * `--tw-ring-color` custom property Tailwind's `ring-*` utilities read) rather
 * than a fixed outline colour or a checkmark glyph — the swatch itself is the
 * only indicator.
 */
import { PALETTE_COLORS } from '@/lib/palette'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <div class="flex items-center gap-2" role="radiogroup" aria-label="Colour">
    <button
      v-for="color in PALETTE_COLORS"
      :key="color.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === color.value"
      :aria-label="color.label"
      :title="color.label"
      class="ring-offset-background size-7 shrink-0 rounded-md outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-offset-2"
      :class="modelValue === color.value ? 'ring-2 ring-offset-2' : ''"
      :style="{ backgroundColor: color.value, '--tw-ring-color': color.value }"
      @click="emit('update:modelValue', color.value)"
    />
  </div>
</template>
