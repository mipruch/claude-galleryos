<script setup lang="ts">
/**
 * One device-command param field in the scene step inspector: a typed widget
 * resolved from the command's schema — a Switch for booleans, a Select for
 * enums, a Slider for a bounded number (both `minimum`/`maximum` declared,
 * e.g. a 0..1 fader level), a plain Input otherwise. Split out of
 * `SceneStepInspector.vue` so the per-kind widget switch doesn't balloon that
 * template's branching alongside its own target/command/delay/on-failure
 * fields — the same reasoning `WorkflowTargetParamField.vue` split out of
 * `WorkflowTargetInspector.vue` for the analogous case.
 */
import { computed } from 'vue'
import type { SchemaField } from '@/lib/schemaForm'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const props = defineProps<{ field: SchemaField; modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [unknown] }>()

// Pre-resolved bindings so the template is a plain widget-kind switch, with
// no per-branch type-narrowing/fallback expressions of its own to follow.
const stringValue = computed(() => (props.modelValue as string) ?? '')
const displayValue = computed(() => (props.modelValue as string | number) ?? '')
const boolValue = computed(() => !!props.modelValue)
const numericValue = computed(() => {
  const raw = typeof props.modelValue === 'number' ? props.modelValue : Number(props.modelValue)
  return Number.isFinite(raw) ? raw : (props.field.minimum ?? 0)
})
const isBoundedNumber = computed(
  () => props.field.kind === 'number' && props.field.minimum !== undefined && props.field.maximum !== undefined,
)
const inputType = computed(() => (props.field.kind === 'number' ? 'number' : 'text'))
const selectPlaceholder = computed(() => props.field.placeholder ?? 'Select…')
</script>

<template>
  <div class="space-y-1.5">
    <div class="flex items-baseline justify-between">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">{{ field.label }}</Label>
      <span v-if="isBoundedNumber" class="text-sm font-medium tabular-nums">{{ numericValue }}</span>
    </div>

    <div v-if="field.kind === 'boolean'" class="pt-1">
      <Switch :model-value="boolValue" @update:model-value="emit('update:modelValue', $event)" />
    </div>
    <Select
      v-else-if="field.kind === 'enum'"
      :model-value="stringValue"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <SelectTrigger class="w-full"><SelectValue :placeholder="selectPlaceholder" /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem v-for="opt in field.options ?? []" :key="opt" :value="opt">{{ opt }}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
    <template v-else-if="isBoundedNumber">
      <Slider
        class="[&_[data-slot=slider-range]]:bg-brand [&_[data-slot=slider-thumb]]:border-brand"
        :model-value="[numericValue]"
        :min="field.minimum"
        :max="field.maximum"
        :step="field.step ?? 1"
        @update:model-value="emit('update:modelValue', $event?.[0] ?? field.minimum)"
      />
      <p class="text-muted-foreground text-xs">Shown because the command takes a level.</p>
    </template>
    <Input
      v-else
      :type="inputType"
      :placeholder="field.placeholder"
      :model-value="displayValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
