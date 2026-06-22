<script setup lang="ts">
/**
 * Create / edit a schedule (a CRON job that runs a scene). vee-validate + Zod
 * validate the flat form; the cron field gets a client-side sanity check
 * (`isValidCron`) for instant feedback, with the server's parser authoritative
 * on submit. Timezone defaults to the browser's IANA zone.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { ScheduledJobDTO } from '@gallery/types'
import { useSchedulesStore } from '@/stores/schedules'
import { useScenesStore } from '@/stores/scenes'
import { isValidCron } from '@/lib/schedules'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; schedule?: ScheduledJobDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useSchedulesStore()
const scenes = useScenesStore()

const isEdit = computed(() => !!props.schedule)
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    sceneId: z.string().min(1, 'Pick a scene'),
    cron: z.string().min(1, 'Required').refine(isValidCron, 'Use 5 cron fields, e.g. "0 8 * * 1-5"'),
    timezone: z.string().min(1, 'Required'),
    enabled: z.boolean(),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

function hydrate(): void {
  const s = props.schedule
  resetForm({
    values: {
      name: s?.name ?? '',
      sceneId: s?.sceneId ?? '',
      cron: s?.cron ?? '0 8 * * *',
      timezone: s?.timezone ?? browserTz,
      enabled: s?.enabled ?? true,
    },
  })
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      scenes.fetchAll()
      hydrate()
    }
  },
  { immediate: true },
)

const submit = handleSubmit(async (values) => {
  const ok = props.schedule
    ? await store.update(props.schedule.id, values)
    : !!(await store.create(values))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit schedule' : 'New schedule' }}</DialogTitle>
        <DialogDescription>Run a scene automatically on a CRON timer.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Weekday morning open" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="sceneId">
          <FormItem>
            <FormLabel>Scene</FormLabel>
            <Select v-bind="componentField">
              <FormControl>
                <SelectTrigger><SelectValue placeholder="Select a scene…" /></SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="s in scenes.records" :key="s.id" :value="s.id">{{ s.name }}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="cron">
          <FormItem>
            <FormLabel>CRON expression</FormLabel>
            <FormControl><Input class="font-mono" placeholder="0 8 * * 1-5" v-bind="componentField" /></FormControl>
            <FormDescription>minute · hour · day-of-month · month · day-of-week (e.g. "0 8 * * 1-5" = 08:00 on weekdays).</FormDescription>
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

        <FormField v-slot="{ value, handleChange }" name="enabled">
          <FormItem>
            <div class="flex items-center justify-between gap-4">
              <div>
                <FormLabel>Enabled</FormLabel>
                <FormDescription>Arm the timer immediately on save.</FormDescription>
              </div>
              <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
            </div>
          </FormItem>
        </FormField>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
