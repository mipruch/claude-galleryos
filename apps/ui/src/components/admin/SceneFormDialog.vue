<script setup lang="ts">
/**
 * Create / edit a scene. Metadata (name, room, look, tags, favourite) is a flat
 * vee-validate + Zod form; the ordered action list is plain reactive state
 * (`EditAction[]`) edited via `SceneActionRow`, since a nested, reorderable array
 * doesn't fit a flat validation schema. On submit the two are combined: complete
 * actions are converted to `SceneActionInput` (params coerced to their command's
 * schema) and sent with the metadata.
 */
import { computed, ref, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { PlusIcon } from '@lucide/vue'
import type { SceneCreateInput, SceneDTO } from '@gallery/types'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import { emptyAction, isActionComplete, toActionInput, toEditAction, type EditAction } from '@/lib/sceneActions'
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
import { Label } from '@/components/ui/label'
import SceneActionRow from './SceneActionRow.vue'

const props = defineProps<{ open: boolean; scene?: SceneDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useScenesStore()
const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()
const { paramsSchemaFor } = useDeviceCommands()

const NONE = '__none__'
const isEdit = computed(() => !!props.scene)
const actions = ref<EditAction[]>([])
const loadingActions = ref(false)

const validationSchema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    roomId: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    color: z.string().optional(),
    tags: z.string().optional(),
    isFavorite: z.boolean(),
  }),
)

const { handleSubmit, resetForm, isSubmitting } = useForm({ validationSchema })

async function hydrate(): Promise<void> {
  const s = props.scene
  resetForm({
    values: {
      name: s?.name ?? '',
      roomId: s?.roomId ?? '',
      description: s?.description ?? '',
      icon: s?.icon ?? '',
      color: s?.color ?? '',
      tags: (s?.tags ?? []).join(', '),
      isFavorite: s?.isFavorite ?? false,
    },
  })
  actions.value = []
  if (s) {
    loadingActions.value = true
    const full = await store.getOne(s.id)
    actions.value = (full?.actions ?? []).map(toEditAction)
    loadingActions.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      drivers.load()
      connections.init()
      devices.init()
      store.fetchAll()
      void hydrate()
    }
  },
  { immediate: true },
)

function addAction(): void {
  actions.value.push(emptyAction())
}
function removeAction(i: number): void {
  actions.value.splice(i, 1)
}
function move(i: number, delta: number): void {
  const j = i + delta
  if (j < 0 || j >= actions.value.length) return
  const [item] = actions.value.splice(i, 1)
  if (item) actions.value.splice(j, 0, item)
}

const submit = handleSubmit(async (values) => {
  const builtActions = actions.value
    .filter(isActionComplete)
    .map((a, i) => toActionInput(a, i, paramsSchemaFor(a.deviceId, a.command)))

  const tags = (values.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  const payload: SceneCreateInput = {
    name: values.name,
    roomId: values.roomId ? values.roomId : null,
    description: values.description || undefined,
    icon: values.icon || undefined,
    color: values.color || undefined,
    tags: tags.length ? tags : undefined,
    isFavorite: values.isFavorite,
    actions: builtActions,
  }

  const ok = props.scene ? await store.update(props.scene.id, payload) : !!(await store.create(payload))
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit scene' : 'New scene' }}</DialogTitle>
        <DialogDescription>
          A scene runs an ordered list of device commands (and/or other scenes) with one tap.
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <div class="grid grid-cols-2 gap-4">
          <FormField v-slot="{ componentField }" name="name">
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl><Input placeholder="e.g. Lecture mode" v-bind="componentField" /></FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

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
        </div>

        <FormField v-slot="{ componentField }" name="description">
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl><Textarea rows="2" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <div class="grid grid-cols-3 gap-4">
          <FormField v-slot="{ componentField }" name="icon">
            <FormItem>
              <FormLabel>Icon</FormLabel>
              <FormControl><Input placeholder="lucide name" v-bind="componentField" /></FormControl>
            </FormItem>
          </FormField>
          <FormField v-slot="{ componentField }" name="color">
            <FormItem>
              <FormLabel>Color</FormLabel>
              <FormControl><Input placeholder="#22c55e" v-bind="componentField" /></FormControl>
            </FormItem>
          </FormField>
          <FormField v-slot="{ componentField }" name="tags">
            <FormItem>
              <FormLabel>Tags</FormLabel>
              <FormControl><Input placeholder="comma, separated" v-bind="componentField" /></FormControl>
            </FormItem>
          </FormField>
        </div>

        <FormField v-slot="{ value, handleChange }" name="isFavorite">
          <FormItem>
            <div class="flex items-center justify-between gap-4">
              <div>
                <FormLabel>Favourite</FormLabel>
                <FormDescription>Surface this scene in quick actions.</FormDescription>
              </div>
              <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
            </div>
          </FormItem>
        </FormField>

        <!-- Actions editor -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <Label>Actions ({{ actions.length }})</Label>
            <Button type="button" variant="outline" size="sm" @click="addAction">
              <PlusIcon class="size-4" />
              Add step
            </Button>
          </div>

          <p v-if="loadingActions" class="text-muted-foreground text-sm">Loading actions…</p>
          <p v-else-if="!actions.length" class="text-muted-foreground rounded-md border border-dashed py-6 text-center text-sm">
            No actions yet. Add a step to control a device or run another scene.
          </p>

          <SceneActionRow
            v-for="(action, i) in actions"
            :key="i"
            :action="action"
            :index="i"
            :total="actions.length"
            :exclude-scene-id="scene?.id"
            @remove="removeAction(i)"
            @move-up="move(i, -1)"
            @move-down="move(i, 1)"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
