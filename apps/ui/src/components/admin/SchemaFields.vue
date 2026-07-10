<script setup lang="ts">
/**
 * Renders a manifest-driven set of form fields (see `lib/schemaForm`) inside the
 * surrounding vee-validate form. Each field binds to the form by its `key`, so
 * the parent's `useForm({ validationSchema })` validates them with Zod.
 */
import type { SchemaField } from '@/lib/schemaForm'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

defineProps<{ fields: SchemaField[] }>()

/**
 * A field renders as a dropdown when it has either resolved `dynamicOptions`
 * (a `number` field's `connectionEnum`) or a manifest-declared `enum` —
 * unified here so the template only needs one `<Select>` branch instead of
 * two near-identical ones.
 */
function selectOptionsFor(field: SchemaField): { value: string; label: string }[] | undefined {
  if (field.dynamicOptions?.length) return field.dynamicOptions
  if (field.kind === 'enum') return field.options?.map((opt) => ({ value: opt, label: opt }))
  return undefined
}
</script>

<template>
  <FormField v-for="field in fields" :key="field.key" v-slot="{ componentField, value, handleChange }" :name="field.key">
    <FormItem>
      <!-- Switch reads nicer with the label beside it. -->
      <template v-if="field.kind === 'boolean'">
        <div class="flex items-center justify-between gap-4">
          <FormLabel>{{ field.label }}</FormLabel>
          <FormControl>
            <Switch :model-value="!!value" @update:model-value="handleChange" />
          </FormControl>
        </div>
      </template>

      <template v-else>
        <FormLabel>{{ field.label }}</FormLabel>
        <FormControl>
          <Select
            v-if="selectOptionsFor(field)"
            :model-value="value as string"
            @update:model-value="handleChange"
          >
            <SelectTrigger>
              <SelectValue :placeholder="field.placeholder ?? 'Select…'" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="opt in selectOptionsFor(field)" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Input
            v-else
            :type="field.kind === 'number' ? 'number' : 'text'"
            :placeholder="field.placeholder"
            v-bind="componentField"
          />
        </FormControl>
      </template>

      <FormDescription v-if="field.description">{{ field.description }}</FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>
