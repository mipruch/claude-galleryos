<script setup lang="ts">
/**
 * Create / edit a camera (feed reference only — no control, no position).
 * Flat vee-validate + Zod form: name, description, icon, URL, username, password.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { CameraDTO } from '@gallery/types'
import { useCamerasStore } from '@/stores/cameras'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; camera?: CameraDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useCamerasStore()
const isEdit = computed(() => !!props.camera)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    description: z.string().optional(),
    icon: z.string().optional(),
    url: z.string().min(1, 'Required'),
    username: z.string().optional(),
    password: z.string().optional(),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

function hydrate(): void {
  const c = props.camera
  resetForm({
    values: {
      name: c?.name ?? '',
      description: c?.description ?? '',
      icon: c?.icon ?? '',
      url: c?.url ?? '',
      username: c?.username ?? '',
      password: c?.password ?? '',
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
  const payload = {
    name: values.name,
    description: values.description || undefined,
    icon: values.icon || undefined,
    url: values.url,
    username: values.username || undefined,
    password: values.password || undefined,
  }
  const ok = props.camera ? await store.update(props.camera.id, payload) : !!(await store.create(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit camera' : 'New camera' }}</DialogTitle>
        <DialogDescription>A camera feed reference — no control, no position.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Entrance" v-bind="componentField" /></FormControl>
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

        <FormField v-slot="{ componentField }" name="icon">
          <FormItem>
            <FormLabel>Icon</FormLabel>
            <FormControl><Input placeholder="lucide name" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="url">
          <FormItem>
            <FormLabel>URL</FormLabel>
            <FormControl><Input placeholder="rtsp://camera.local/stream" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <div class="grid grid-cols-2 gap-4">
          <FormField v-slot="{ componentField }" name="username">
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl><Input autocomplete="off" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="password">
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl><Input type="password" autocomplete="new-password" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
