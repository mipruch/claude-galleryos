<script setup lang="ts">
/**
 * One trigger-action param field: a typed widget resolved from the command's
 * schema — a Switch for booleans, a Select for enums, an Input otherwise,
 * the same pattern `SceneActionRow.vue` uses for scene actions — or, once
 * toggled, a raw text field for a template token (`{arg[0]}`/`{:name}`).
 * Split out of `TriggerActionInspector.vue` so the per-kind widget switch
 * doesn't balloon that template's branching alongside its own command-picker
 * and summary logic.
 */
import { computed } from 'vue'
import type { SchemaField } from '@/lib/schemaForm'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import TriggerActionEnumSelect from './TriggerActionEnumSelect.vue'

const props = defineProps<{
  field: SchemaField
  modelValue: unknown
  tokenMode: boolean
  /** Only a mapping-owned action has a firing signal to reference — a schedule fire never shows the toggle. */
  showTokenToggle: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [unknown]; 'update:tokenMode': [boolean] }>()

// Pre-resolved bindings so the template is a plain widget-kind switch, with
// no per-branch type-narrowing/fallback expressions of its own to follow.
const stringValue = computed(() => (props.modelValue as string) ?? '')
const displayValue = computed(() => (props.modelValue as string | number) ?? '')
const boolValue = computed(() => !!props.modelValue)
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
    <TriggerActionEnumSelect
      v-else-if="field.kind === 'enum'"
      :model-value="stringValue"
      :options="field.options"
      :placeholder="selectPlaceholder"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <Input
      v-else
      :type="inputType"
      :placeholder="field.placeholder"
      :model-value="displayValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
