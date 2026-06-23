<script setup lang="ts">
/**
 * Editor for an "array of objects" address field — the bit of JSON Schema the
 * generic SchemaFields deliberately leaves out (it only does scalars). Used for a
 * meter widget's `meters` list, but driven entirely by the schema's `items`, so
 * it works for any homogeneous object array.
 *
 * Each row is one object; its inputs are derived from `items.properties`. Values
 * are coerced to the declared type (number vs string) so the payload matches the
 * server's address schema.
 */
import { computed } from 'vue'
import type { JsonSchema } from '@gallery/driver-core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const props = defineProps<{
  label: string
  description?: string
  schema: JsonSchema
  modelValue: Record<string, unknown>[]
}>()
const emit = defineEmits<{ 'update:modelValue': [Record<string, unknown>[]] }>()

interface ItemField {
  key: string
  label: string
  isNumber: boolean
  default: unknown
}

const itemFields = computed<ItemField[]>(() => {
  const properties = (props.schema.items?.properties ?? {}) as Record<string, JsonSchema>
  return Object.entries(properties).map(([key, prop]) => ({
    key,
    label: (prop.title as string | undefined) ?? key,
    isNumber: prop.type === 'integer' || prop.type === 'number',
    default: prop.default,
  }))
})

const rows = computed(() => props.modelValue ?? [])

function emitRows(next: Record<string, unknown>[]): void {
  emit('update:modelValue', next)
}

function blankRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const f of itemFields.value) row[f.key] = f.default ?? (f.isNumber ? undefined : '')
  return row
}

function addRow(): void {
  emitRows([...rows.value, blankRow()])
}

function removeRow(index: number): void {
  emitRows(rows.value.filter((_, i) => i !== index))
}

function updateCell(index: number, field: ItemField, raw: string): void {
  const value = field.isNumber ? (raw === '' ? undefined : Number(raw)) : raw
  const next = rows.value.map((row, i) => (i === index ? { ...row, [field.key]: value } : row))
  emitRows(next)
}
</script>

<template>
  <div class="space-y-2">
    <Label>{{ label }}</Label>
    <p v-if="description" class="text-muted-foreground text-sm">{{ description }}</p>

    <div v-if="rows.length" class="space-y-2">
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="flex items-end gap-2 rounded-md border p-2"
      >
        <div v-for="field in itemFields" :key="field.key" class="flex-1 space-y-1">
          <Label class="text-muted-foreground text-xs">{{ field.label }}</Label>
          <Input
            :type="field.isNumber ? 'number' : 'text'"
            :model-value="(row[field.key] as string | number | undefined) ?? ''"
            @update:model-value="updateCell(index, field, String($event))"
          />
        </div>
        <Button type="button" variant="outline" size="sm" @click="removeRow(index)">Remove</Button>
      </div>
    </div>
    <p v-else class="text-muted-foreground text-sm">No entries yet.</p>

    <Button type="button" variant="outline" size="sm" @click="addRow">Add</Button>
  </div>
</template>
