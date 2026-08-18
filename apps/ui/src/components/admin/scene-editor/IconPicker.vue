<script setup lang="ts">
/**
 * Icon picker — a square preview (tinted with the scene's chosen colour) that
 * opens a popover grid of the app's global icon set (`lib/icons.ts`). No
 * free-text Lucide name entry: every value this emits is one of
 * `SCENE_ICONS`, the same list `sceneIcon()` resolves against.
 */
import { computed, ref } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SCENE_ICONS, DEFAULT_SCENE_ICON_NAME, normalizeIconName } from '@/lib/icons'

const props = defineProps<{ modelValue: string; color: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const selectedName = computed(() => normalizeIconName(props.modelValue) ?? DEFAULT_SCENE_ICON_NAME)
const selected = computed(() => SCENE_ICONS.find((option) => option.name === selectedName.value) ?? SCENE_ICONS[0]!)

function pick(name: string): void {
  emit('update:modelValue', name)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger
      type="button"
      aria-label="Choose an icon"
      class="ring-offset-background focus-visible:ring-ring flex size-12 shrink-0 items-center justify-center rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-offset-2"
      :style="{ backgroundColor: `${color}1a`, color }"
    >
      <component :is="selected.icon" class="size-6" />
    </PopoverTrigger>
    <PopoverContent align="start" class="w-64 p-2">
      <div class="grid grid-cols-5 gap-1">
        <button
          v-for="option in SCENE_ICONS"
          :key="option.name"
          type="button"
          :aria-label="option.label"
          :aria-pressed="option.name === selectedName"
          :title="option.label"
          class="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex size-10 items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-2"
          :class="option.name === selectedName ? 'bg-accent text-foreground' : ''"
          @click="pick(option.name)"
        >
          <component :is="option.icon" class="size-5" />
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
