<script setup lang="ts">
/**
 * Chip-style tag editor — replaces the old comma-separated text input.
 * Click "+ tag" to reveal a small text field; Enter/blur commits it as a new
 * chip (trimmed, deduped, case-insensitive). Each chip has its own remove ×.
 */
import { nextTick, ref } from 'vue'
import { XIcon } from '@lucide/vue'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const adding = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function remove(tag: string): void {
  emit('update:modelValue', props.modelValue.filter((t) => t !== tag))
}

async function startAdding(): Promise<void> {
  adding.value = true
  draft.value = ''
  await nextTick()
  inputRef.value?.focus()
}

function commit(): void {
  const value = draft.value.trim()
  adding.value = false
  if (!value) return
  const exists = props.modelValue.some((t) => t.toLowerCase() === value.toLowerCase())
  if (!exists) emit('update:modelValue', [...props.modelValue, value])
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <span
      v-for="tag in modelValue"
      :key="tag"
      class="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm"
    >
      {{ tag }}
      <button
        type="button"
        :aria-label="`Remove tag ${tag}`"
        class="hover:text-foreground text-muted-foreground -mr-0.5 rounded-xs"
        @click="remove(tag)"
      >
        <XIcon class="size-3.5" />
      </button>
    </span>

    <input
      v-if="adding"
      ref="inputRef"
      v-model="draft"
      type="text"
      class="border-input bg-background focus-visible:ring-ring h-[30px] w-24 rounded-md border px-2 text-sm outline-none focus-visible:ring-2"
      placeholder="Tag name"
      @keydown.enter.prevent="commit"
      @keydown.escape="adding = false"
      @blur="commit"
    />
    <button
      v-else
      type="button"
      class="border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md border border-dashed px-2 py-1 text-sm transition-colors"
      @click="startAdding"
    >
      + tag
    </button>
  </div>
</template>
