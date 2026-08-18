<script setup lang="ts">
/**
 * Right-hand field editor for the step currently selected on the stage board
 * — the redesigned replacement for the old `SceneActionRow`. Mutates the
 * passed `action` in place (it lives in the parent's stage array) the same
 * way the row did; a device action resolves its command list and param
 * fields from the driver manifest (`useDeviceCommands`), a sub-scene action
 * just picks another scene.
 *
 * Parallel grouping is no longer edited here — which stage column a card
 * lives in *is* its `parallelGroup` (see `lib/sceneStages.ts`), set by
 * dragging the card on the board, not a number typed in this panel.
 */
import { computed, watch } from 'vue'
import { ChevronDownIcon, ChevronUpIcon, LinkIcon, SlidersHorizontalIcon, Trash2Icon, XIcon } from '@lucide/vue'
import type { OnFailure } from '@gallery/types'
import type { EditAction } from '@/lib/sceneActions'
import { schemaToFields } from '@/lib/schemaForm'
import { useDeviceCommands } from '@/composables/useDeviceCommands'
import { useDevicesStore } from '@/stores/devices'
import { useScenesStore } from '@/stores/scenes'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import SceneStepParamField from './SceneStepParamField.vue'

const props = defineProps<{
  action: EditAction
  stageNumber: number
  cardNumber: number
  excludeSceneId?: string
}>()
const emit = defineEmits<{ remove: []; close: [] }>()

const devices = useDevicesStore()
const scenes = useScenesStore()
const { commandsFor, paramsSchemaFor } = useDeviceCommands()

const isSubScene = computed(() => props.action.target === 'scene')
const commands = computed(() => commandsFor(props.action.deviceId))
/** The first few commands, offered as one-tap pills above the full dropdown. */
const quickCommands = computed(() => commands.value.slice(0, 4))
const paramFields = computed(() => schemaToFields(paramsSchemaFor(props.action.deviceId, props.action.command)))
const otherScenes = computed(() => scenes.records.filter((s) => s.id !== props.excludeSceneId))

const DELAY_STEP_MS = 50

function nudgeDelay(delta: number): void {
  const next = Math.max(0, (Number(props.action.delayMs) || 0) + delta)
  props.action.delayMs = String(next)
}

function setTarget(target: EditAction['target']): void {
  if (props.action.target === target) return
  props.action.target = target
  props.action.deviceId = ''
  props.action.command = ''
  props.action.params = {}
  props.action.childSceneId = ''
}

function setOnFailure(value: OnFailure): void {
  props.action.onFailure = value
}

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
  <div class="flex flex-col gap-5">
    <div class="flex items-start justify-between gap-2">
      <div class="flex flex-col gap-1.5">
        <Badge :variant="isSubScene ? 'scene' : 'device'" class="w-fit uppercase">
          <component :is="isSubScene ? LinkIcon : SlidersHorizontalIcon" class="size-3" />
          {{ isSubScene ? 'Run scene' : 'Device command' }}
        </Badge>
        <p class="text-muted-foreground text-xs">Stage {{ stageNumber }} · card {{ cardNumber }}</p>
      </div>
      <div class="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove step" @click="emit('remove')">
          <Trash2Icon class="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close inspector" @click="emit('close')">
          <XIcon class="size-4" />
        </Button>
      </div>
    </div>

    <div class="border-input inline-flex w-fit rounded-md border p-0.5 text-sm">
      <button
        type="button"
        class="rounded-sm px-2.5 py-1 font-medium transition-colors"
        :class="!isSubScene ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="setTarget('device')"
      >
        Device command
      </button>
      <button
        type="button"
        class="rounded-sm px-2.5 py-1 font-medium transition-colors"
        :class="isSubScene ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="setTarget('scene')"
      >
        Run scene
      </button>
    </div>

    <!-- Device command target -->
    <template v-if="!isSubScene">
      <div class="space-y-1.5">
        <Label class="text-muted-foreground text-xs tracking-wide uppercase">Device</Label>
        <Select v-model="action.deviceId">
          <SelectTrigger class="w-full"><SelectValue placeholder="Select a device…" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="d in devices.records" :key="d.id" :value="d.id">{{ d.name }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div class="space-y-1.5">
        <Label class="text-muted-foreground text-xs tracking-wide uppercase">Command</Label>
        <Select v-model="action.command" :disabled="!action.deviceId">
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="action.command || 'Select a command…'" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem v-for="c in commands" :key="c.command" :value="c.command">{{ c.command }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div v-if="quickCommands.length" class="flex flex-wrap gap-1.5 pt-1">
          <button
            v-for="c in quickCommands"
            :key="c.command"
            type="button"
            class="rounded-md border px-2 py-1 text-xs font-medium transition-colors"
            :class="
              action.command === c.command
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            "
            @click="action.command = c.command"
          >
            {{ c.command }}
          </button>
        </div>
      </div>

      <!-- Command params, rendered from the command's paramsSchema. -->
      <SceneStepParamField
        v-for="f in paramFields"
        :key="f.key"
        :field="f"
        :model-value="action.params[f.key]"
        @update:model-value="action.params[f.key] = $event"
      />
    </template>

    <!-- Sub-scene target -->
    <div v-else class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Scene to run</Label>
      <Select v-model="action.childSceneId">
        <SelectTrigger class="w-full"><SelectValue placeholder="Select a scene…" /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="s in otherScenes" :key="s.id" :value="s.id">{{ s.name }}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>

    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Delay</Label>
      <div class="flex items-center gap-2">
        <Input v-model="action.delayMs" type="number" min="0" placeholder="0" class="w-full" />
        <span class="text-muted-foreground text-sm">ms</span>
        <div class="flex flex-col">
          <button
            type="button"
            aria-label="Increase delay"
            class="text-muted-foreground hover:text-foreground"
            @click="nudgeDelay(DELAY_STEP_MS)"
          >
            <ChevronUpIcon class="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Decrease delay"
            class="text-muted-foreground hover:text-foreground"
            @click="nudgeDelay(-DELAY_STEP_MS)"
          >
            <ChevronDownIcon class="size-3.5" />
          </button>
        </div>
      </div>
    </div>

    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">On failure</Label>
      <div class="border-input inline-flex w-fit rounded-md border p-0.5 text-sm">
        <button
          type="button"
          class="rounded-sm px-3 py-1 font-medium transition-colors"
          :class="
            action.onFailure === 'continue'
              ? 'bg-brand text-brand-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="setOnFailure('continue')"
        >
          Continue
        </button>
        <button
          type="button"
          class="rounded-sm px-3 py-1 font-medium transition-colors"
          :class="
            action.onFailure === 'abort'
              ? 'bg-brand text-brand-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="setOnFailure('abort')"
        >
          Abort
        </button>
      </div>
    </div>

    <p class="text-muted-foreground border-t pt-4 text-xs">
      Parallel grouping comes from the card's stage — drag it to another column to change it.
    </p>
  </div>
</template>
