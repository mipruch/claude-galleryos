<script setup lang="ts">
/**
 * Right-sidebar inspector for a selected CRON schedule trigger. Replaces the
 * old bare "cron expression + timezone" text fields with a friendlier
 * "Repeats: Daily/Weekly/Monthly/Interval/Custom" picker (`lib/cron.ts`'s
 * `CronBuilderState`) that generates a valid 5-field expression — "Custom"
 * (or the "Edit expression" shortcut into it) drops back to editing the raw
 * string directly, for anything the picker's four templates can't express.
 *
 * The highlighted summary sentence (`describeCronSentence`) is a pure
 * function of the in-progress picker state, so it updates immediately as the
 * user toggles weekdays/time — no server round-trip needed. The "Next run"/
 * "Next runs" preview, by contrast, comes from the schedules store's cached
 * `/schedules/:id/next` preview (real cron-engine math, not reproduced
 * client-side), so it reflects the *last saved* expression and only advances
 * once Save round-trips a new one — `schedulesStore.previewsFor` is read
 * through a computed, so it updates in place after that save without this
 * component remounting (the parent view only remounts it on a new *selection*).
 *
 * The parent view keys the dispatcher on the selected node's id, so a fresh
 * instance mounts per selection and this local builder state never needs
 * re-hydrating mid-lifetime — same pattern `WorkflowTargetInspector` uses.
 */
import { computed, reactive, ref } from 'vue'
import { CalendarClockIcon, ChevronRightIcon, Trash2Icon, XIcon } from '@lucide/vue'
import type { ScheduledJobDTO } from '@gallery/types'
import { useSchedulesStore } from '@/stores/schedules'
import { cronFromState, describeCronSentence, stateFromCron, type RepeatMode } from '@/lib/cron'
import { formatDatePart, formatDateTime, formatRelative, formatTimePart, isValidCron, nextRunOf } from '@/lib/schedules'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import CronRepeatFields from './CronRepeatFields.vue'

const props = defineProps<{ schedule: ScheduledJobDTO }>()
const emit = defineEmits<{ remove: []; close: [] }>()

const schedulesStore = useSchedulesStore()

const name = ref(props.schedule.name)
const timezone = ref(props.schedule.timezone)
const enabled = ref(props.schedule.enabled)
const builder = reactive(stateFromCron(props.schedule.cron))

const REPEAT_MODES: ReadonlyArray<{ value: RepeatMode; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'interval', label: 'Interval' },
  { value: 'custom', label: 'Custom' },
]

// `Intl.supportedValuesOf('timeZone')` enumerates IANA zone *names* but
// omits the bare "UTC" alias — common as a browser/server default (and thus
// as `createTrigger`'s new-schedule default) — so it's added explicitly.
// The schedule's own current value is added too, in case it's an older
// alias the running ICU version no longer enumerates; either way the
// select always has a matching option instead of rendering blank.
const TIMEZONE_OPTIONS: string[] = [
  ...new Set([
    'UTC',
    ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
    props.schedule.timezone,
  ]),
].sort()

const generatedCron = computed(() => cronFromState(builder))
const cronValid = computed(() => isValidCron(generatedCron.value))
const summarySentence = computed(() => describeCronSentence(generatedCron.value))

// The store's preview is real cron-engine math for the *last saved*
// expression (see the module doc) — showing it against an edited-but-unsaved
// expression would silently lie about when the schedule will actually next
// fire, so it's only shown once the picker matches what's saved.
const previewsStale = computed(() => generatedCron.value !== props.schedule.cron || timezone.value !== props.schedule.timezone)
const previews = computed(() => (previewsStale.value ? [] : schedulesStore.previewsFor(props.schedule.id)))
const nextRun = computed(() => (previewsStale.value ? null : nextRunOf(props.schedule, previews.value)))
const nowMs = Date.now()

function editExpression(): void {
  builder.customExpr = generatedCron.value
  builder.mode = 'custom'
}

const saving = ref(false)

async function submit(): Promise<void> {
  if (!cronValid.value) return
  saving.value = true
  try {
    await schedulesStore.update(props.schedule.id, {
      name: name.value,
      cron: generatedCron.value,
      timezone: timezone.value,
      enabled: enabled.value,
    })
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  await schedulesStore.remove(props.schedule.id)
  emit('remove')
}

defineExpose({ remove })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <Badge variant="cron" class="shrink-0 text-[10px] tracking-wide uppercase">
          <CalendarClockIcon class="size-3" />
          Cron trigger
        </Badge>
        <p class="min-w-0 truncate text-sm font-semibold">{{ name || schedule.name }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete" @click="remove">
          <Trash2Icon class="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" @click="emit('close')">
          <XIcon class="size-4" />
        </Button>
      </div>
    </div>

    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Name</Label>
      <Input v-model="name" />
    </div>

    <div class="bg-accent/60 rounded-lg border px-3 py-2.5">
      <p class="text-sm font-semibold">{{ summarySentence }}</p>
      <p class="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
        <span class="bg-brand inline-block size-1.5 shrink-0 rounded-full" />
        <template v-if="nextRun">
          Next run {{ formatDateTime(nextRun) }} · {{ formatRelative(nextRun, nowMs) }}
        </template>
        <template v-else>Save to preview upcoming runs</template>
      </p>
    </div>

    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Repeats</Label>
      <div class="border-input flex w-full rounded-md border p-0.5 text-sm">
        <button
          v-for="m in REPEAT_MODES"
          :key="m.value"
          type="button"
          class="flex-1 rounded-sm px-1.5 py-1.5 text-center text-xs font-medium transition-colors"
          :class="builder.mode === m.value ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="builder.mode = m.value"
        >
          {{ m.label }}
        </button>
      </div>
    </div>

    <CronRepeatFields
      :builder="builder"
      :timezone="timezone"
      :timezone-options="TIMEZONE_OPTIONS"
      :cron-valid="cronValid"
      @update:timezone="timezone = $event"
    />

    <div v-if="previews.length" class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Next runs</Label>
      <div class="divide-y rounded-md border">
        <div v-for="run in previews.slice(0, 3)" :key="run" class="flex items-center justify-between px-3 py-2 text-xs">
          <span>{{ formatDatePart(run) }}</span>
          <span class="text-muted-foreground font-mono">{{ formatTimePart(run) }}</span>
        </div>
      </div>
    </div>

    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Cron</Label>
      <div class="flex items-center justify-between gap-2">
        <code class="bg-muted rounded-md px-2 py-1.5 font-mono text-xs">{{ generatedCron }}</code>
        <Button
          v-if="builder.mode !== 'custom'"
          type="button"
          variant="link"
          size="sm"
          class="h-auto shrink-0 p-0 text-xs"
          @click="editExpression"
        >
          Edit expression
          <ChevronRightIcon class="size-3" />
        </Button>
      </div>
    </div>

    <div class="flex items-center justify-between gap-4 border-t pt-4">
      <div>
        <p class="text-sm font-medium">Enabled</p>
        <p class="text-muted-foreground text-xs">Trigger fires on schedule</p>
      </div>
      <Switch :model-value="enabled" @update:model-value="enabled = $event" />
    </div>

    <Button :disabled="saving || !cronValid" @click="submit">Save</Button>
  </div>
</template>
