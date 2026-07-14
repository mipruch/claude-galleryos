<script setup lang="ts">
/**
 * The enum-kind widget for one workflow-target param field: a `<Select>`
 * populated from the schema field's options. Split out of
 * `WorkflowTargetParamField.vue` purely to keep its options `v-for` from
 * adding to that template's already-branching widget-kind switch.
 */
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

defineProps<{
  modelValue: string
  options: string[] | undefined
  placeholder: string
}>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <Select :model-value="modelValue" @update:model-value="emit('update:modelValue', String($event ?? ''))">
    <SelectTrigger><SelectValue :placeholder="placeholder" /></SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectItem v-for="opt in options" :key="opt" :value="opt">{{ opt }}</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
