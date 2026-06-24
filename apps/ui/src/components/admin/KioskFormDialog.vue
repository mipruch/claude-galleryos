<script setup lang="ts">
/**
 * Create / edit a kiosk layout's metadata: name (the `/kiosk/:name` key) plus
 * the canvas geometry — pixel width/height and the grid granularity (columns +
 * row height) the builder and viewer share. Editing preserves the placed tiles;
 * only the geometry changes. vee-validate + Zod validate the flat form.
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { KioskDTO } from '@gallery/types'
import { useKiosksStore } from '@/stores/kiosks'
import { KIOSK_MAX_SIZE, KIOSK_MIN_SIZE } from '@/lib/kiosks'
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

const props = defineProps<{ open: boolean; kiosk?: KioskDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [KioskDTO] }>()

const store = useKiosksStore()

const isEdit = computed(() => !!props.kiosk)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required').max(100, 'Too long'),
    width: z.coerce.number().int('Whole number').min(KIOSK_MIN_SIZE).max(KIOSK_MAX_SIZE),
    height: z.coerce.number().int('Whole number').min(KIOSK_MIN_SIZE).max(KIOSK_MAX_SIZE),
    columns: z.coerce.number().int('Whole number').min(1).max(48),
    cellHeight: z.coerce.number().int('Whole number').min(8).max(1000),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

function hydrate(): void {
  const k = props.kiosk
  resetForm({
    values: k
      ? { name: k.name, width: k.width, height: k.height, columns: k.config.columns, cellHeight: k.config.cellHeight }
      : { name: '', width: 1920, height: 1080, columns: 12, cellHeight: 80 },
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
  // Editing preserves existing tiles; create starts with an empty grid.
  const tiles = props.kiosk?.config.tiles ?? []
  const config = { columns: values.columns, cellHeight: values.cellHeight, tiles }
  const saved = props.kiosk
    ? await store.update(props.kiosk.id, { name: values.name, width: values.width, height: values.height, config })
    : await store.create({ name: values.name, width: values.width, height: values.height, config })
  if (saved) {
    emit('saved', saved)
    emit('update:open', false)
  }
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit layout' : 'New layout' }}</DialogTitle>
        <DialogDescription>
          A wall screen / tablet shown chromeless at <code>/kiosk/{name}</code>. Set the canvas size; a
          larger canvas than the display scrolls.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="e.g. Main Hall" v-bind="componentField" /></FormControl>
            <FormDescription>Used in the URL — must be unique.</FormDescription>
            <FormMessage />
          </FormItem>
        </FormField>

        <div class="grid grid-cols-2 gap-4">
          <FormField v-slot="{ componentField }" name="width">
            <FormItem>
              <FormLabel>Width (px)</FormLabel>
              <FormControl><Input type="number" min="1" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="height">
            <FormItem>
              <FormLabel>Height (px)</FormLabel>
              <FormControl><Input type="number" min="1" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <FormField v-slot="{ componentField }" name="columns">
            <FormItem>
              <FormLabel>Grid columns</FormLabel>
              <FormControl><Input type="number" min="1" max="48" v-bind="componentField" /></FormControl>
              <FormDescription>Horizontal snap granularity.</FormDescription>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="cellHeight">
            <FormItem>
              <FormLabel>Row height (px)</FormLabel>
              <FormControl><Input type="number" min="8" v-bind="componentField" /></FormControl>
              <FormDescription>Height of one grid row.</FormDescription>
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
