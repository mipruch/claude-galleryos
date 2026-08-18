<script setup lang="ts">
/**
 * Create / edit a role. `isAdmin` grants full admin-portal access and every
 * device, ignoring the list below. Otherwise `deviceIds` — the devices this
 * role may see in the User UI — is plain reactive state edited as a full
 * replacement set (same reasoning as the scene editor's stage board: a
 * per-device toggle list doesn't fit a flat validation schema).
 */
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { RoleDTO } from '@gallery/types'
import { useRolesStore } from '@/stores/roles'
import { useDevicesStore } from '@/stores/devices'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; role?: RoleDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useRolesStore()
const devicesStore = useDevicesStore()
const isEdit = computed(() => !!props.role)
const deviceIds = ref<string[]>([])

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    isAdmin: z.boolean(),
    description: z.string().optional(),
  }),
)

const { handleSubmit, resetForm, isSubmitting, values } = useForm({ validationSchema })

function hydrate(): void {
  const r = props.role
  resetForm({
    values: {
      name: r?.name ?? '',
      isAdmin: r?.isAdmin ?? false,
      description: r?.description ?? '',
    },
  })
  deviceIds.value = [...(r?.deviceIds ?? [])]
}

watch(
  () => props.open,
  (open) => {
    if (open) hydrate()
  },
  { immediate: true },
)

function toggleDevice(id: string, checked: boolean): void {
  if (checked) {
    if (!deviceIds.value.includes(id)) deviceIds.value.push(id)
  } else {
    deviceIds.value = deviceIds.value.filter((d) => d !== id)
  }
}

// Devices grouped by room, so the checklist reads like the main device grid.
const devicesByRoom = computed(() => {
  const groups = new Map<string, { name: string; devices: { id: string; name: string }[] }>()
  for (const d of devicesStore.records) {
    const key = d.roomId ?? '__unassigned__'
    if (!groups.has(key)) {
      const name = devicesStore.rooms.find((r) => r.id === d.roomId)?.name ?? 'Unassigned'
      groups.set(key, { name, devices: [] })
    }
    groups.get(key)!.devices.push({ id: d.id, name: d.name })
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
})

const submit = handleSubmit(async (formValues) => {
  const payload = {
    name: formValues.name,
    isAdmin: formValues.isAdmin,
    description: formValues.description || undefined,
    deviceIds: deviceIds.value,
  }
  const ok = props.role ? await store.update(props.role.id, payload) : !!(await store.create(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit role' : 'New role' }}</DialogTitle>
        <DialogDescription>Roles gate what the frontend shows — assign one to a user in Users.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Custodian" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="description">
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl><Textarea rows="2" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ value, handleChange }" name="isAdmin">
          <FormItem>
            <div class="flex items-center justify-between gap-4">
              <div>
                <FormLabel>Admin access</FormLabel>
                <FormDescription>Full admin portal, and every device — ignores the list below.</FormDescription>
              </div>
              <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
            </div>
          </FormItem>
        </FormField>

        <div v-if="!values.isAdmin" class="flex flex-col gap-3 rounded-md border p-3">
          <p class="text-muted-foreground text-sm">
            Devices visible to this role in the User UI ({{ deviceIds.length }} selected).
          </p>
          <div v-for="group in devicesByRoom" :key="group.name" class="flex flex-col gap-1">
            <p class="text-muted-foreground text-xs font-medium uppercase">{{ group.name }}</p>
            <label v-for="d in group.devices" :key="d.id" class="flex items-center justify-between gap-2 py-1">
              <span class="text-sm">{{ d.name }}</span>
              <Switch
                :model-value="deviceIds.includes(d.id)"
                @update:model-value="(checked) => toggleDevice(d.id, !!checked)"
              />
            </label>
          </div>
          <p v-if="!devicesByRoom.length" class="text-muted-foreground text-sm">No devices yet.</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
