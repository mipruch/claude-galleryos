<script setup lang="ts">
/**
 * Create / edit a connection. The driver select drives a dynamic field set
 * generated from the driver's `connectionSchema` (see `lib/schemaForm`), while
 * vee-validate + Zod validate the whole form. On submit the schema values are
 * split: `host`/`port` populate the dedicated columns, the rest is the freeform
 * `config` blob (the server re-merges them to validate against the manifest).
 */
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { ConnectionDTO } from '@gallery/types'
import type { ConnectionView } from '@/stores/connections'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { defaultsFromSchema, pruneEmpty, schemaToFields, zodFromSchema } from '@/lib/schemaForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import SchemaFields from './SchemaFields.vue'

const props = defineProps<{ open: boolean; connection?: ConnectionView | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useConnectionsStore()
const drivers = useDriversStore()

const PROTOCOLS = ['tcp', 'udp', 'http', 'serial'] as const

const isEdit = computed(() => !!props.connection)
// Driver lives outside the validated form: it *picks* which dynamic schema (and
// thus which fields/validation) applies, so it can't depend on the form itself.
const driverId = ref('')
const manifest = computed(() => drivers.get(driverId.value))
const configSchema = computed(() => manifest.value?.connectionSchema)
const configFields = computed(() => schemaToFields(configSchema.value))

const validationSchema = computed(() =>
  toTypedSchema(
    z
      .object({
        name: z.string().min(1, 'Required'),
        protocol: z.string().min(1, 'Required'),
        enabled: z.boolean(),
      })
      .merge(zodFromSchema(configSchema.value)),
  ),
)

const { handleSubmit, resetForm, isSubmitting, setFieldValue } = useForm({ validationSchema })

/** Reset the form to a connection (edit) or empty defaults (create). */
function hydrate(): void {
  const c = props.connection
  driverId.value = c?.driverId ?? ''
  const config = (c?.config as Record<string, unknown> | undefined) ?? {}
  resetForm({
    values: {
      name: c?.name ?? '',
      protocol: c?.protocol ?? 'tcp',
      enabled: c?.enabled ?? true,
      ...defaultsFromSchema(configSchema.value),
      ...config,
      // host/port are columns, not config — surface them as schema fields.
      ...(c?.host != null ? { host: c.host } : {}),
      ...(c?.port != null ? { port: c.port } : {}),
    },
  })
}

// Re-seed dynamic fields when the driver changes (create flow), preserving the
// static fields the user may already have typed.
watch(driverId, (next, prev) => {
  if (prev === undefined || next === prev || isEdit.value) return
  for (const [key, value] of Object.entries(defaultsFromSchema(configSchema.value))) {
    setFieldValue(key, value)
  }
})

watch(
  () => props.open,
  (open) => {
    if (open) {
      drivers.load()
      hydrate()
    }
  },
  { immediate: true },
)

const submit = handleSubmit(async (values) => {
  if (!driverId.value) return
  const schemaKeys = configFields.value.map((f) => f.key)
  const config: Record<string, unknown> = {}
  for (const key of schemaKeys) {
    if (key === 'host' || key === 'port') continue
    config[key] = (values as Record<string, unknown>)[key]
  }
  const payload: Partial<ConnectionDTO> = {
    name: values.name,
    driverId: driverId.value,
    protocol: values.protocol,
    enabled: values.enabled,
    host: schemaKeys.includes('host') ? ((values as Record<string, unknown>).host as string) || null : undefined,
    port: schemaKeys.includes('port')
      ? ((values as Record<string, unknown>).port as number | undefined) ?? null
      : undefined,
    config: pruneEmpty(config),
  }

  const ok = props.connection
    ? await store.update(props.connection.id, payload)
    : !!(await store.create(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit connection' : 'New connection' }}</DialogTitle>
        <DialogDescription>
          A connection is one socket/HTTP endpoint to a device or gateway. Fields below come from the
          selected driver.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <!-- Driver picker (drives the dynamic fields; not a vee-validate field). -->
        <div class="space-y-2">
          <Label>Driver</Label>
          <Select v-model="driverId" :disabled="isEdit">
            <SelectTrigger>
              <SelectValue placeholder="Select a driver…" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="d in drivers.manifests" :key="d.id" :value="d.id">
                  {{ d.name }} — {{ d.vendor }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="isEdit" class="text-muted-foreground text-sm">The driver can't be changed after creation.</p>
          <p v-else-if="!driverId" class="text-muted-foreground text-sm">Pick a driver to see its settings.</p>
        </div>

        <template v-if="driverId">
          <FormField v-slot="{ componentField }" name="name">
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input placeholder="e.g. Hall A projector" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <!-- Driver-specific config (host, port, and any extras). -->
          <SchemaFields :fields="configFields" />

          <FormField v-slot="{ componentField }" name="protocol">
            <FormItem>
              <FormLabel>Protocol</FormLabel>
              <Select v-bind="componentField">
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Protocol" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem v-for="p in PROTOCOLS" :key="p" :value="p">{{ p.toUpperCase() }}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ value, handleChange }" name="enabled">
            <FormItem>
              <div class="flex items-center justify-between gap-4">
                <div>
                  <FormLabel>Enabled</FormLabel>
                  <FormDescription>Start the driver and connect on save.</FormDescription>
                </div>
                <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
              </div>
            </FormItem>
          </FormField>
        </template>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!driverId || isSubmitting">
            {{ isEdit ? 'Save changes' : 'Create' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
