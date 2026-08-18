<script setup lang="ts">
/**
 * Right-sidebar inspector for a selected ingress mapping trigger — edits its
 * name, protocol + pattern, and enabled state. Split out of the old
 * `TriggerInspector.vue` (which now just dispatches between this and
 * `CronScheduleForm.vue`) so the mapping form's plain vee-validate schema
 * doesn't sit alongside the cron form's much richer local builder state.
 *
 * The parent view keys the dispatcher on the selected node's id, so a fresh
 * instance mounts per selection and `useForm`'s `initialValues` never needs
 * re-hydrating mid-lifetime.
 */
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { Trash2Icon, WaypointsIcon, XIcon } from '@lucide/vue'
import type { InputMappingDTO } from '@gallery/types'
import { useMappingsStore } from '@/stores/mappings'
import { PROTOCOL_OPTIONS, protocolLabel } from '@/lib/mappings'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const props = defineProps<{ mapping: InputMappingDTO }>()
const emit = defineEmits<{ remove: []; close: [] }>()

const mappingsStore = useMappingsStore()

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    protocol: z.enum(['osc', 'tcp', 'http']),
    pattern: z.string().min(1, 'Required'),
    enabled: z.boolean(),
  }),
)

const { handleSubmit, isSubmitting, values } = useForm({
  validationSchema,
  initialValues: {
    name: props.mapping.name,
    protocol: props.mapping.protocol,
    pattern: props.mapping.pattern,
    enabled: props.mapping.enabled,
  },
})

const submit = handleSubmit(async (v) => {
  await mappingsStore.update(props.mapping.id, {
    name: v.name,
    protocol: v.protocol,
    pattern: v.pattern,
    enabled: v.enabled,
  })
})

async function remove(): Promise<void> {
  await mappingsStore.remove(props.mapping.id)
  emit('remove')
}

defineExpose({ remove })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <Badge variant="ingress" class="shrink-0 text-[10px] tracking-wide uppercase">
          <WaypointsIcon class="size-3" />
          {{ protocolLabel(values.protocol ?? mapping.protocol) }} trigger
        </Badge>
        <p class="min-w-0 truncate text-sm font-semibold">{{ values.name || mapping.name }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete" @click="remove">
          <Trash2Icon class="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" @click="emit('close')">
          <XIcon class="size-4" />
        </Button>
      </div>
    </div>

    <form class="flex flex-col gap-4" @submit="submit">
      <FormField v-slot="{ componentField }" name="name">
        <FormItem>
          <FormLabel>Name</FormLabel>
          <FormControl><Input v-bind="componentField" /></FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="protocol">
        <FormItem>
          <FormLabel>Protocol</FormLabel>
          <Select v-bind="componentField">
            <FormControl>
              <SelectTrigger><SelectValue /></SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="p in PROTOCOL_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="pattern">
        <FormItem>
          <FormLabel>Pattern</FormLabel>
          <FormControl><Input class="font-mono" placeholder="/dim/:level" v-bind="componentField" /></FormControl>
          <FormDescription>Exact (<code>/scene/go</code>) or parameterised (<code>/dim/:level</code>).</FormDescription>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ value, handleChange }" name="enabled">
        <FormItem>
          <div class="flex items-center justify-between gap-4">
            <FormLabel>Enabled</FormLabel>
            <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
          </div>
        </FormItem>
      </FormField>

      <Button type="submit" :disabled="isSubmitting">Save</Button>
    </form>
  </div>
</template>
