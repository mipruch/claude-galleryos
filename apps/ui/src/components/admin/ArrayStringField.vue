<script setup lang="ts">
/**
 * Editor for an "array of strings" connection-config field.
 * Each entry gets its own text input; the user can add and remove rows.
 * Sends a proper string[] to the parent — no join/split round-trips.
 */
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const props = defineProps<{
  label: string
  description?: string
  modelValue: string[]
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

function update(index: number, value: string): void {
  const next = [...props.modelValue]
  next[index] = value
  emit('update:modelValue', next)
}

function addRow(): void {
  emit('update:modelValue', [...props.modelValue, ''])
}

function removeRow(index: number): void {
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index))
}
</script>

<template>
  <div class="space-y-2">
    <Label>{{ label }}</Label>
    <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>

    <div v-if="modelValue.length" class="space-y-2">
      <div
        v-for="(entry, index) in modelValue"
        :key="index"
        class="flex items-center gap-2"
      >
        <span class="text-muted-foreground w-6 shrink-0 text-right text-sm">{{ index + 1 }}</span>
        <Input
          :model-value="entry"
          :placeholder="placeholder ?? `Input ${index + 1}`"
          class="flex-1"
          @update:model-value="update(index, String($event))"
        />
        <Button type="button" variant="outline" size="sm" @click="removeRow(index)">Remove</Button>
      </div>
    </div>
    <p v-else class="text-muted-foreground text-sm">No labels defined yet.</p>

    <Button type="button" variant="outline" size="sm" @click="addRow">Add</Button>
  </div>
</template>
