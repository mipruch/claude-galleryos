<script setup lang="ts">
/**
 * One workflow-target param field: a typed widget resolved from the command's
 * schema — a Switch for booleans, a Select for enums, a Slider for a bounded
 * number (both `minimum`/`maximum` declared, e.g. a 0..1 fader level), a plain
 * Input otherwise — the same pattern the scene editor's step inspector uses
 * for scene actions — or, once toggled, a raw text field for a template token
 * (`{arg[0]}`/`{:name}`). Split out of `WorkflowTargetInspector.vue` so the
 * per-kind widget switch doesn't balloon that template's branching alongside
 * its own command-picker and summary logic.
 */
import { computed } from 'vue'
import type { SchemaField } from '@/lib/schemaForm'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import WorkflowTargetEnumSelect from './WorkflowTargetEnumSelect.vue'

const props = defineProps<{
  field: SchemaField
  modelValue: unknown
  tokenMode: boolean
  /** Only a target with at least one incoming mapping-owned wire has a firing signal to reference — a schedule-only target never shows the toggle. */
  showTokenToggle: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [unknown]; 'update:tokenMode': [boolean] }>()

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
    <div class="flex items-center justify-between gap-2">
      <Label class="text-xs">{{ field.label }}</Label>
      <Button
        v-if="showTokenToggle"
        type="button"
        variant="link"
        size="sm"
        class="h-auto p-0 text-[10px]"
        @click="emit('update:tokenMode', !tokenMode)"
      >
        {{ tokenMode ? 'Use a value' : 'From signal' }}
      </Button>
    </div>

    <Input
      v-if="tokenMode"
      class="font-mono text-xs"
      placeholder="{arg[0]} or {:name}"
      :model-value="stringValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <div v-else-if="field.kind === 'boolean'" class="pt-1">
      <Switch :model-value="boolValue" @update:model-value="emit('update:modelValue', $event)" />
    </div>
    <WorkflowTargetEnumSelect
      v-else-if="field.kind === 'enum'"
      :model-value="stringValue"
      :options="field.options"
      :placeholder="selectPlaceholder"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <div v-else-if="isBoundedNumber" class="flex items-center gap-3 pt-1">
      <Slider
        class="flex-1"
        :model-value="[numericValue]"
        :min="field.minimum"
        :max="field.maximum"
        :step="field.step ?? 1"
        @update:model-value="emit('update:modelValue', $event?.[0] ?? field.minimum)"
      />
      <span class="text-muted-foreground w-12 shrink-0 text-right text-xs tabular-nums">{{ numericValue }}</span>
    </div>
    <Input
      v-else
      :type="inputType"
      :placeholder="field.placeholder"
      :model-value="displayValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
