<script setup lang="ts">
/**
 * Right-sidebar inspector for a selected trigger node (a mapping or a
 * schedule) — the canvas replacement for the old MappingFormDialog /
 * ScheduleFormDialog modals. Edits only the trigger's own identity (name,
 * enabled, and its protocol+pattern or cron+timezone); wiring what it fires is
 * a canvas connection instead, opening `WorkflowTargetInspector` on the
 * target end when selected.
 *
 * The parent view keys this component on the selected node's id
 * (`:key="…"` in WorkflowsView), so a fresh instance mounts per selection and
 * `useForm`'s `initialValues` (read once at setup) never needs re-hydrating.
 */
import { computed } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { Trash2Icon } from '@lucide/vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'
import { useMappingsStore } from '@/stores/mappings'
import { useSchedulesStore } from '@/stores/schedules'
import { PROTOCOL_OPTIONS } from '@/lib/mappings'
import { isValidCron } from '@/lib/schedules'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

const props = defineProps<{ data: Extract<RoutingNodeData, { kind: 'mapping' | 'schedule' }> }>()
const emit = defineEmits<{ remove: [] }>()

const mappingsStore = useMappingsStore()
const schedulesStore = useSchedulesStore()
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const isMapping = computed(() => props.data.kind === 'mapping')

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    protocol: z.enum(['osc', 'tcp', 'http']),
    pattern: z.string().min(1, 'Required'),
    cron: z.string().min(1, 'Required').refine(isValidCron, 'Use 5 cron fields, e.g. "0 8 * * 1-5"'),
    timezone: z.string().min(1, 'Required'),
    enabled: z.boolean(),
  }),
)

const initialValues =
  props.data.kind === 'mapping'
    ? {
        name: props.data.mapping.name,
        protocol: props.data.mapping.protocol,
        pattern: props.data.mapping.pattern,
        cron: '0 8 * * *',
        timezone: browserTz,
        enabled: props.data.mapping.enabled,
      }
    : {
        name: props.data.schedule.name,
        protocol: 'osc' as const,
        pattern: '/',
        cron: props.data.schedule.cron,
        timezone: props.data.schedule.timezone,
        enabled: props.data.schedule.enabled,
      }

const { handleSubmit, isSubmitting } = useForm({ validationSchema, initialValues })

const submit = handleSubmit(async (v) => {
  if (props.data.kind === 'mapping') {
    await mappingsStore.update(props.data.mapping.id, {
      name: v.name,
      protocol: v.protocol,
      pattern: v.pattern,
      enabled: v.enabled,
    })
  } else {
    await schedulesStore.update(props.data.schedule.id, {
      name: v.name,
      cron: v.cron,
      timezone: v.timezone,
      enabled: v.enabled,
    })
  }
})

async function remove(): Promise<void> {
  if (props.data.kind === 'mapping') await mappingsStore.remove(props.data.mapping.id)
  else await schedulesStore.remove(props.data.schedule.id)
  emit('remove')
}

// Lets the parent view's Delete-key shortcut delete the active node through
// the exact same function its own trash button calls.
defineExpose({ remove })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2">
      <p class="text-sm font-medium">{{ isMapping ? 'Mapping' : 'Schedule' }}</p>
      <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="remove">
        <Trash2Icon class="size-4" />
      </Button>
    </div>

    <form class="flex flex-col gap-4" @submit="submit">
      <FormField v-slot="{ componentField }" name="name">
        <FormItem>
          <FormLabel>Name</FormLabel>
          <FormControl><Input v-bind="componentField" /></FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <!-- mapping: protocol + pattern -->
      <template v-if="isMapping">
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
      </template>

      <!-- schedule: cron + timezone -->
      <template v-else>
        <FormField v-slot="{ componentField }" name="cron">
          <FormItem>
            <FormLabel>CRON expression</FormLabel>
            <FormControl><Input class="font-mono" placeholder="0 8 * * 1-5" v-bind="componentField" /></FormControl>
            <FormDescription>minute · hour · day-of-month · month · day-of-week.</FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="timezone">
          <FormItem>
            <FormLabel>Timezone</FormLabel>
            <FormControl><Input placeholder="Europe/Prague" v-bind="componentField" /></FormControl>
            <FormDescription>IANA zone the CRON expression is interpreted in.</FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>
      </template>

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
