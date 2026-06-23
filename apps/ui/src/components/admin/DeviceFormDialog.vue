<script setup lang="ts">
/**
 * Create / edit a device (endpoint). Picking a connection resolves its driver,
 * whose endpoint types populate the type select; the chosen endpoint type's
 * `addressSchema` drives the dynamic address fields (see `lib/schemaForm`).
 * Capabilities are derived from the endpoint type's commands, so the operator
 * never hand-maintains them. vee-validate + Zod validate the whole form.
 */
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import type { JsonSchema } from '@gallery/driver-core'
import { defaultsFromSchema, pruneEmpty, schemaToFields, zodFromSchema } from '@/lib/schemaForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import SchemaFields from './SchemaFields.vue'
import ArrayObjectField from './ArrayObjectField.vue'

const props = defineProps<{ open: boolean; device?: DeviceRecord | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()

const DEVICE_TYPES = [
  'lighting', 'audio', 'microphone', 'video', 'display', 'matrix', 'blind', 'power', 'custom',
] as const

// Sentinel for the "no room" option (reka-ui forbids an empty <SelectItem value>).
const NONE = '__none__'

const isEdit = computed(() => !!props.device)

// Connection + endpoint type live outside the validated form: they *select*
// which dynamic address schema (and thus validation) applies.
const connectionId = ref('')
const subtype = ref('')

const driverId = computed(() => connections.connections.find((c) => c.id === connectionId.value)?.driverId)
const endpointTypes = computed(() => drivers.endpointTypes(driverId.value))
const endpointType = computed(() => drivers.endpointType(driverId.value, subtype.value))
const addressSchema = computed(() => endpointType.value?.addressSchema)
const addressFields = computed(() => schemaToFields(addressSchema.value))

// Array-of-object address properties (e.g. a meter widget's `meters`) are edited
// outside vee-validate by ArrayObjectField; the scalar schema form skips them.
interface ArrayProperty {
  key: string
  label: string
  description?: string
  schema: JsonSchema
}
const arrayProperties = computed<ArrayProperty[]>(() => {
  const props = (addressSchema.value?.properties ?? {}) as Record<string, JsonSchema>
  return Object.entries(props)
    .filter(([, prop]) => prop.type === 'array')
    .map(([key, prop]) => ({
      key,
      label: (prop.title as string | undefined) ?? key,
      description: prop.description as string | undefined,
      schema: prop,
    }))
})
/** Live values for each array property, keyed by property name. */
const arrays = ref<Record<string, Record<string, unknown>[]>>({})

const validationSchema = computed(() =>
  toTypedSchema(
    z
      .object({
        name: z.string().min(1, 'Required'),
        type: z.string().min(1, 'Required'),
        roomId: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        enabled: z.boolean(),
      })
      .merge(zodFromSchema(addressSchema.value)),
  ),
)

const { handleSubmit, resetForm, isSubmitting, setFieldValue } = useForm({ validationSchema })

function hydrate(): void {
  const d = props.device
  connectionId.value = d?.connectionId ?? ''
  subtype.value = d?.subtype ?? ''
  const address = (d?.address as Record<string, unknown> | undefined) ?? {}
  // Seed array-of-object fields from the saved address (or empty).
  arrays.value = Object.fromEntries(
    arrayProperties.value.map((p) => [p.key, Array.isArray(address[p.key]) ? (address[p.key] as Record<string, unknown>[]) : []]),
  )
  resetForm({
    values: {
      name: d?.name ?? '',
      type: d?.type ?? 'custom',
      roomId: d?.roomId ?? '',
      description: d?.description ?? '',
      icon: d?.icon ?? '',
      enabled: d?.enabled ?? true,
      ...defaultsFromSchema(addressSchema.value),
      ...address,
    },
  })
}

// Re-seed address fields when the endpoint type changes (create flow).
watch(subtype, (next, prev) => {
  if (prev === undefined || next === prev || isEdit.value) return
  for (const [key, value] of Object.entries(defaultsFromSchema(addressSchema.value))) {
    setFieldValue(key, value)
  }
  // Reset array-of-object fields to empty for the newly selected endpoint type.
  arrays.value = Object.fromEntries(arrayProperties.value.map((p) => [p.key, []]))
})

// Changing the connection invalidates the endpoint type (different driver).
watch(connectionId, (next, prev) => {
  if (prev === undefined || next === prev || isEdit.value) return
  subtype.value = ''
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      drivers.load()
      connections.init()
      hydrate()
    }
  },
  { immediate: true },
)

const submit = handleSubmit(async (values) => {
  // Wait for the manifest to resolve the endpoint type — otherwise capabilities
  // (derived from its commands) would persist as an empty list.
  if (!connectionId.value || !subtype.value || !endpointType.value) return
  const address = pruneEmpty(
    Object.fromEntries(addressFields.value.map((f) => [f.key, (values as Record<string, unknown>)[f.key]])),
  )
  // Merge in array-of-object fields (the meters list), which live outside the form.
  for (const p of arrayProperties.value) address[p.key] = arrays.value[p.key] ?? []
  const payload: Partial<DeviceRecord> = {
    connectionId: connectionId.value,
    name: values.name,
    type: values.type,
    roomId: values.roomId ? values.roomId : null,
    description: values.description || undefined,
    icon: values.icon || undefined,
    subtype: subtype.value,
    address,
    capabilities: (endpointType.value?.commands ?? []).map((c) => c.command),
    enabled: values.enabled,
  }

  const ok = props.device
    ? await devices.updateDevice(props.device.id, payload)
    : !!(await devices.createDevice(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit device' : 'New device' }}</DialogTitle>
        <DialogDescription>
          A device is one addressable endpoint under a connection (a fader, a fixture, a display…).
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <!-- Connection picker (resolves the driver + endpoint types; not a vee-validate field). -->
        <div class="space-y-2">
          <Label>Connection</Label>
          <Select v-model="connectionId" :disabled="isEdit">
            <SelectTrigger><SelectValue placeholder="Select a connection…" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="c in connections.connections" :key="c.id" :value="c.id">{{ c.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="isEdit" class="text-muted-foreground text-sm">The connection can't be changed after creation.</p>
        </div>

        <div v-if="connectionId" class="space-y-2">
          <Label>Endpoint type</Label>
          <Select v-model="subtype">
            <SelectTrigger><SelectValue placeholder="Select an endpoint type…" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel v-if="!endpointTypes.length">No endpoint types for this driver</SelectLabel>
                <SelectItem v-for="e in endpointTypes" :key="e.type" :value="e.type">{{ e.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="endpointType?.description" class="text-muted-foreground text-sm">{{ endpointType.description }}</p>
        </div>

        <template v-if="connectionId && subtype">
          <FormField v-slot="{ componentField }" name="name">
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input placeholder="e.g. Lectern mic" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="type">
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select v-bind="componentField">
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Device type" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="t in DEVICE_TYPES" :key="t" :value="t">{{ t }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>

          <!-- reka-ui forbids an empty <SelectItem value>; map the NONE sentinel to ''. -->
          <FormField v-slot="{ value, handleChange }" name="roomId">
            <FormItem>
              <FormLabel>Room</FormLabel>
              <Select
                :model-value="(value as string) || NONE"
                @update:model-value="handleChange($event === NONE ? '' : $event)"
              >
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="No room" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem :value="NONE">No room</SelectItem>
                    <SelectItem v-for="r in devices.rooms" :key="r.id" :value="r.id">{{ r.name }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>

          <!-- Driver-specific address (HiQnet node, DALI id, output number…). -->
          <SchemaFields :fields="addressFields" />

          <!-- Array-of-object address fields (e.g. a meter widget's meters). -->
          <ArrayObjectField
            v-for="p in arrayProperties"
            :key="p.key"
            :label="p.label"
            :description="p.description"
            :schema="p.schema"
            :model-value="arrays[p.key] ?? []"
            @update:model-value="arrays[p.key] = $event"
          />

          <FormField v-slot="{ componentField }" name="description">
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl><Textarea rows="2" v-bind="componentField" /></FormControl>
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
        </template>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!connectionId || !subtype || !endpointType || isSubmitting">
            {{ isEdit ? 'Save changes' : 'Create' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
