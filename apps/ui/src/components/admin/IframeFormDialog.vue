<script setup lang="ts">
/**
 * Create / edit an iframe (one embedded device UI / sidebar entry).
 * vee-validate + Zod validate the flat form; the URL field gets a client-side
 * `http(s)` check (`isEmbeddableUrl`) so the embed will actually load, with the
 * server authoritative on submit.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { IframeDTO } from '@gallery/types'
import { useIframesStore } from '@/stores/iframes'
import { isEmbeddableUrl } from '@/lib/iframes'
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
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; iframe?: IframeDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useIframesStore()

const isEdit = computed(() => !!props.iframe)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    url: z.string().min(1, 'Required').refine(isEmbeddableUrl, 'Use an absolute http(s) URL'),
    displayOrder: z.coerce.number().int('Whole number').min(0, 'Must be 0 or more'),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

function hydrate(): void {
  const f = props.iframe
  resetForm({
    values: f
      ? { name: f.name, url: f.url, displayOrder: f.displayOrder }
      : { name: '', url: '', displayOrder: 0 },
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
  const ok = props.iframe
    ? await store.update(props.iframe.id, values)
    : !!(await store.create(values))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit iframe' : 'New iframe' }}</DialogTitle>
        <DialogDescription>Embed an external device UI as a user-panel sidebar entry.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Pixera" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="url">
          <FormItem>
            <FormLabel>URL</FormLabel>
            <FormControl><Input placeholder="https://device.local/ui" v-bind="componentField" /></FormControl>
            <FormDescription>Absolute http(s) URL of the page to embed.</FormDescription>
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

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
