<script setup lang="ts">
/**
 * Create / edit an input mapping (OSC/TCP/HTTP signal → action). vee-validate +
 * Zod validate the flat form; the required target fields depend on the chosen
 * `targetType` (a scene for "Run scene", a device + command for "Device
 * command"). `paramsTemplate` is edited as JSON text and parsed on submit.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { InputMappingDTO, InputProtocol, InputTargetType } from '@gallery/types'
import { useMappingsStore } from '@/stores/mappings'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import {
  PROTOCOL_OPTIONS,
  TARGET_TYPE_OPTIONS,
  isValidParamsTemplate,
  parseParamsTemplate,
  stringifyParamsTemplate,
  usesParams,
} from '@/lib/mappings'
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
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; mapping?: InputMappingDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useMappingsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()
const { commandsFor } = useDeviceCommands()

const isEdit = computed(() => !!props.mapping)

const validationSchema = toTypedSchema(
  z
    .object({
      name: z.string().min(1, 'Required'),
      protocol: z.enum(['osc', 'tcp', 'http']),
      pattern: z.string().min(1, 'Required'),
      targetType: z.enum(['scene.execute', 'device.command', 'event.emit']),
      targetId: z.string(),
      targetCommand: z.string(),
      paramsTemplate: z.string(),
      enabled: z.boolean(),
    })
    .superRefine((v, ctx) => {
      if (v.targetType === 'scene.execute' && !v.targetId) {
        ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'Pick a scene' })
      }
      if (v.targetType === 'device.command') {
        if (!v.targetId) ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'Pick a device' })
        if (!v.targetCommand) ctx.addIssue({ code: 'custom', path: ['targetCommand'], message: 'Pick a command' })
      }
      if (usesParams(v.targetType) && !isValidParamsTemplate(v.paramsTemplate)) {
        ctx.addIssue({ code: 'custom', path: ['paramsTemplate'], message: 'Must be a JSON object' })
      }
    }),
)

const { handleSubmit, resetForm, isSubmitting, values, setFieldValue } = useForm({ validationSchema })

/** Commands available for the currently-selected device. */
const deviceCommands = computed(() => (values.targetId ? commandsFor(values.targetId) : []))

function hydrate(): void {
  const m = props.mapping
  resetForm({
    values: {
      name: m?.name ?? '',
      protocol: (m?.protocol as InputProtocol) ?? 'osc',
      pattern: m?.pattern ?? '/',
      targetType: (m?.targetType as InputTargetType) ?? 'scene.execute',
      targetId: m?.targetId ?? '',
      targetCommand: m?.targetCommand ?? '',
      paramsTemplate: stringifyParamsTemplate(m?.paramsTemplate),
      enabled: m?.enabled ?? true,
    },
  })
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      scenes.fetchAll()
      devices.fetchAll()
      connections.fetchAll()
      void drivers.load()
      hydrate()
    }
  },
  { immediate: true },
)

// Switching target type clears fields that no longer apply, so a stale device id
// can't ride along on a scene rule (the server would reject it anyway).
watch(
  () => values.targetType,
  (type) => {
    if (type === 'scene.execute') setFieldValue('targetCommand', '')
    if (type === 'event.emit') {
      setFieldValue('targetId', '')
      setFieldValue('targetCommand', '')
    }
  },
)

// Changing the device drops a command that the new device doesn't offer.
watch(
  () => values.targetId,
  (deviceId) => {
    if (values.targetType !== 'device.command') return
    if (deviceId && !commandsFor(deviceId).some((c) => c.command === values.targetCommand)) {
      setFieldValue('targetCommand', '')
    }
  },
)

const submit = handleSubmit(async (v) => {
  const targetType = v.targetType
  const parsed = usesParams(targetType) ? parseParamsTemplate(v.paramsTemplate) : null
  const input = {
    name: v.name,
    protocol: v.protocol,
    pattern: v.pattern,
    targetType,
    targetId: targetType === 'event.emit' ? null : v.targetId || null,
    targetCommand: targetType === 'device.command' ? v.targetCommand || null : null,
    paramsTemplate: parsed?.ok ? parsed.value : {},
    enabled: v.enabled,
  }
  const ok = props.mapping ? await store.update(props.mapping.id, input) : !!(await store.create(input))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit mapping' : 'New mapping' }}</DialogTitle>
        <DialogDescription>Route an incoming OSC/TCP/HTTP signal to an action.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Stage dimmer from console" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <div class="grid grid-cols-2 gap-4">
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

          <FormField v-slot="{ componentField }" name="targetType">
            <FormItem>
              <FormLabel>Action</FormLabel>
              <Select v-bind="componentField">
                <FormControl>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="t in TARGET_TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>
        </div>

        <FormField v-slot="{ componentField }" name="pattern">
          <FormItem>
            <FormLabel>Pattern</FormLabel>
            <FormControl><Input class="font-mono" placeholder="/dim/:level" v-bind="componentField" /></FormControl>
            <FormDescription>Exact (<code>/scene/go</code>) or parameterised (<code>/dim/:level</code>, capturing <code>:level</code>).</FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <!-- scene.execute → pick a scene -->
        <FormField v-if="values.targetType === 'scene.execute'" v-slot="{ componentField }" name="targetId">
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

        <!-- device.command → pick a device + command -->
        <template v-if="values.targetType === 'device.command'">
          <FormField v-slot="{ componentField }" name="targetId">
            <FormItem>
              <FormLabel>Device</FormLabel>
              <Select v-bind="componentField">
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Select a device…" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="d in devices.records" :key="d.id" :value="d.id">{{ d.name }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="targetCommand">
            <FormItem>
              <FormLabel>Command</FormLabel>
              <Select v-bind="componentField" :disabled="!values.targetId">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue :placeholder="values.targetId ? 'Select a command…' : 'Pick a device first'" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="c in deviceCommands" :key="c.command" :value="c.command">
                      {{ c.command }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>
        </template>

        <!-- params template (device.command / event.emit) -->
        <FormField v-if="usesParams(values.targetType)" v-slot="{ componentField }" name="paramsTemplate">
          <FormItem>
            <FormLabel>Params template</FormLabel>
            <FormControl>
              <Textarea class="font-mono text-xs" rows="4" placeholder='{ "level": "{:level}" }' v-bind="componentField" />
            </FormControl>
            <FormDescription>
              JSON. Reference the signal with <code>{arg[0]}</code> (Nth argument) or <code>{:name}</code> (captured path param); other values are literals.
            </FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ value, handleChange }" name="enabled">
          <FormItem>
            <div class="flex items-center justify-between gap-4">
              <div>
                <FormLabel>Enabled</FormLabel>
                <FormDescription>Match incoming signals as soon as it's saved.</FormDescription>
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
