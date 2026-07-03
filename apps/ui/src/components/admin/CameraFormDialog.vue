<script setup lang="ts">
/**
 * Create / edit a camera (one RTSP CCTV source / sidebar entry).
 * vee-validate + Zod validate the flat form; the URL field gets a client-side
 * `rtsp(s)` check (`isRtspUrl`), with the server authoritative on submit.
 *
 * Credentials are write-only: the API never returns a stored `username`/
 * `password` (see `CameraDTO`), so on edit both fields start blank and a blank
 * value means "leave the stored credential unchanged" rather than "clear it".
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { CameraDTO } from '@gallery/types'
import { useCamerasStore } from '@/stores/cameras'
import { isRtspUrl } from '@/lib/cameras'
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
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; camera?: CameraDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useCamerasStore()

const isEdit = computed(() => !!props.camera)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    url: z.string().min(1, 'Required').refine(isRtspUrl, 'Use an absolute rtsp(s) URL'),
    username: z.string(),
    password: z.string(),
    displayOrder: z.coerce.number().int('Whole number').min(0, 'Must be 0 or more'),
    enabled: z.boolean(),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

function hydrate(): void {
  const c = props.camera
  resetForm({
    values: c
      ? { name: c.name, url: c.url, username: '', password: '', displayOrder: c.displayOrder, enabled: c.enabled }
      : { name: '', url: '', username: '', password: '', displayOrder: 0, enabled: true },
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
    url: values.url,
    // Blank credential fields mean "leave unchanged" on edit; omit them so the
    // server's partial update doesn't overwrite a stored credential with "".
    ...(values.username ? { username: values.username } : {}),
    ...(values.password ? { password: values.password } : {}),
    displayOrder: values.displayOrder,
    enabled: values.enabled,
  }
  const ok = props.camera
    ? await store.update(props.camera.id, payload)
    : !!(await store.create(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit camera' : 'New camera' }}</DialogTitle>
        <DialogDescription>Add an RTSP CCTV source as a user-panel sidebar entry.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Front gate" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="url">
          <FormItem>
            <FormLabel>URL</FormLabel>
            <FormControl><Input placeholder="rtsp://10.0.0.5:554/Streaming/Channels/101" v-bind="componentField" /></FormControl>
            <FormDescription>Absolute rtsp(s) URL, without credentials.</FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="username">
          <FormItem>
            <FormLabel>Username</FormLabel>
            <FormControl><Input autocomplete="off" placeholder="optional" v-bind="componentField" /></FormControl>
            <FormDescription>
              {{ isEdit ? 'Leave blank to keep the stored username.' : 'Optional; injected server-side when connecting.' }}
            </FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="password">
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl><Input type="password" autocomplete="new-password" placeholder="optional" v-bind="componentField" /></FormControl>
            <FormDescription>
              {{ isEdit ? 'Leave blank to keep the stored password.' : 'Optional; never sent to the browser after saving.' }}
            </FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="displayOrder">
          <FormItem>
            <FormLabel>Display order</FormLabel>
            <FormControl><Input type="number" min="0" v-bind="componentField" /></FormControl>
            <FormDescription>Sidebar position — lower numbers appear first.</FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ value, handleChange }" name="enabled">
          <FormItem>
            <div class="flex items-center justify-between gap-4">
              <FormLabel>Enabled</FormLabel>
              <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
            </div>
            <FormDescription>Whether this camera is selectable in the user panel.</FormDescription>
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
