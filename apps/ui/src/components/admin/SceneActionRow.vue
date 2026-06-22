<script setup lang="ts">
/**
 * One editable scene action. Mutates the passed `action` in place (it lives in
 * the parent's reactive array) and emits reorder/remove intents. A device action
 * resolves its command list and param fields from the driver manifest (via
 * `useDeviceCommands`); a sub-scene action just picks another scene.
 */
import { computed, watch } from 'vue'
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, XIcon } from '@lucide/vue'
import type { EditAction } from '@/lib/sceneActions'
import { schemaToFields } from '@/lib/schemaForm'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const props = defineProps<{
  action: EditAction
  index: number
  total: number
  excludeSceneId?: string
}>()
const emit = defineEmits<{ remove: []; moveUp: []; moveDown: [] }>()

const devices = useDevicesStore()
const scenes = useScenesStore()
const { commandsFor, paramsSchemaFor } = useDeviceCommands()

const commands = computed(() => commandsFor(props.action.deviceId))
const paramFields = computed(() =>
  schemaToFields(paramsSchemaFor(props.action.deviceId, props.action.command)),
)
const otherScenes = computed(() => scenes.records.filter((s) => s.id !== props.excludeSceneId))

// Selecting a different device invalidates the chosen command + its params.
watch(
  () => props.action.deviceId,
  () => {
    props.action.command = ''
    props.action.params = {}
  },
)
// A new command starts with fresh params.
watch(
  () => props.action.command,
  () => {
    props.action.params = {}
  },
)
</script>

<template>
  <div class="bg-muted/30 flex flex-col gap-3 rounded-md border p-3">
    <div class="flex items-center gap-2">
      <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
      <span class="text-muted-foreground text-xs font-medium">Step {{ index + 1 }}</span>

      <Select v-model="action.target">
        <SelectTrigger class="ml-2 h-8 w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="device">Device command</SelectItem>
            <SelectItem value="scene">Run sub-scene</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <div class="ml-auto flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" :disabled="index === 0" @click="emit('moveUp')">
          <ArrowUpIcon class="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Move down"
          :disabled="index === total - 1"
          @click="emit('moveDown')"
        >
          <ArrowDownIcon class="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove step" @click="emit('remove')">
          <XIcon class="size-4" />
        </Button>
      </div>
    </div>

    <!-- Device command target -->
    <template v-if="action.target === 'device'">
      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <Label class="text-xs">Device</Label>
          <Select v-model="action.deviceId">
            <SelectTrigger><SelectValue placeholder="Select a device…" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="d in devices.records" :key="d.id" :value="d.id">{{ d.name }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1.5">
          <Label class="text-xs">Command</Label>
          <Select v-model="action.command" :disabled="!action.deviceId">
            <SelectTrigger><SelectValue placeholder="Select a command…" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="c in commands" :key="c.command" :value="c.command">{{ c.command }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <!-- Command params, rendered from the command's paramsSchema. -->
      <div v-if="paramFields.length" class="grid grid-cols-2 gap-3">
        <div v-for="f in paramFields" :key="f.key" class="space-y-1.5">
          <Label class="text-xs">{{ f.label }}</Label>
          <div v-if="f.kind === 'boolean'" class="pt-1">
            <Switch :model-value="!!action.params[f.key]" @update:model-value="action.params[f.key] = $event" />
          </div>
          <Select
            v-else-if="f.kind === 'enum'"
            :model-value="(action.params[f.key] as string) ?? ''"
            @update:model-value="action.params[f.key] = $event"
          >
            <SelectTrigger><SelectValue :placeholder="f.placeholder ?? 'Select…'" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            v-else
            :type="f.kind === 'number' ? 'number' : 'text'"
            :placeholder="f.placeholder"
            :model-value="(action.params[f.key] as string | number) ?? ''"
            @update:model-value="action.params[f.key] = $event"
          />
        </div>
      </div>
    </template>

    <!-- Sub-scene target -->
    <template v-else>
      <div class="space-y-1.5">
        <Label class="text-xs">Scene to run</Label>
        <Select v-model="action.childSceneId">
          <SelectTrigger><SelectValue placeholder="Select a scene…" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="s in otherScenes" :key="s.id" :value="s.id">{{ s.name }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </template>

    <!-- Scheduling knobs shared by both targets. -->
    <div class="grid grid-cols-3 gap-3">
      <div class="space-y-1.5">
        <Label class="text-xs">Delay (ms)</Label>
        <Input v-model="action.delayMs" type="number" min="0" placeholder="0" />
      </div>
      <div class="space-y-1.5">
        <Label class="text-xs">Parallel group</Label>
        <Input v-model="action.parallelGroup" type="number" min="0" placeholder="0" />
      </div>
      <div class="space-y-1.5">
        <Label class="text-xs">On failure</Label>
        <Select v-model="action.onFailure">
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="continue">Continue</SelectItem>
              <SelectItem value="abort">Abort</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  </div>
</template>
