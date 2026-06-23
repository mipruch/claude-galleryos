<script setup lang="ts">
/**
 * Create / edit a room. Flat vee-validate + Zod form (name, description, icon,
 * colour). Display order isn't edited here — it's managed by reordering in the
 * list view.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { RoomDTO } from '@gallery/types'
import { useRoomsStore } from '@/stores/rooms'
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
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; room?: RoomDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useRoomsStore()
const isEdit = computed(() => !!props.room)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    description: z.string().optional(),
    icon: z.string().optional(),
    // Empty (no colour) or a #RRGGBB hex.
    color: z
      .string()
      .optional()
      .refine((v) => !v || /^#[0-9a-fA-F]{6}$/.test(v), 'Use a #RRGGBB hex colour'),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

function hydrate(): void {
  const r = props.room
  resetForm({
    values: {
      name: r?.name ?? '',
      description: r?.description ?? '',
      icon: r?.icon ?? '',
      color: r?.color ?? '',
    },
  })
}

watch(
  () => props.open,
  (open) => {
    if (open) hydrate()
  },
  { immediate: true },
)

const submit = handleSubmit(async (values) => {
  const payload: Partial<RoomDTO> = {
    name: values.name,
    description: values.description || null,
    icon: values.icon || null,
    color: values.color || null,
  }
  const ok = props.room ? await store.update(props.room.id, payload) : !!(await store.create(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit room' : 'New room' }}</DialogTitle>
        <DialogDescription>Rooms group devices and scenes and drive the user sidebar.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Main Hall" v-bind="componentField" /></FormControl>
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

        <div class="grid grid-cols-2 gap-4">
          <FormField v-slot="{ componentField }" name="icon">
            <FormItem>
              <FormLabel>Icon</FormLabel>
              <FormControl><Input placeholder="lucide name" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField, value }" name="color">
            <FormItem>
              <FormLabel>Colour</FormLabel>
              <div class="flex items-center gap-2">
                <span
                  class="size-9 shrink-0 rounded-md border"
                  :style="{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(value as string) ? (value as string) : 'transparent' }"
                />
                <FormControl><Input placeholder="#22c55e" v-bind="componentField" /></FormControl>
              </div>
              <FormMessage />
            </FormItem>
          </FormField>
        </div>

        <FormDescription>Display order is set by reordering in the rooms list.</FormDescription>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
