<script setup lang="ts">
/**
 * The "Repeats" mode's own fields — split out of `CronScheduleForm.vue`
 * purely to keep that file's per-mode `v-if` branching (weekly weekdays,
 * monthly day-of-month, interval value+unit, custom raw expression, and the
 * At/Timezone row every mode but custom shows) from ballooning its already
 * form-heavy template. `builder` is the parent's `reactive` `CronBuilderState`
 * — mutated directly here, same pattern `SceneStepInspector` uses for its
 * `action` prop, since a plain object reference stays reactive across the
 * boundary without needing a round-trip through emits for every keystroke.
 */
import { computed } from 'vue'
import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_SHORT_LABELS, type CronBuilderState } from '@/lib/cron'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const props = defineProps<{
  builder: CronBuilderState
  timezone: string
  timezoneOptions: string[]
  cronValid: boolean
}>()
const emit = defineEmits<{ 'update:timezone': [string] }>()

const showAtTime = computed(() => props.builder.mode === 'daily' || props.builder.mode === 'weekly' || props.builder.mode === 'monthly')

const atTime = computed({
  get: () => `${String(props.builder.hour).padStart(2, '0')}:${String(props.builder.minute).padStart(2, '0')}`,
  set: (value: string) => {
    const [h, m] = value.split(':').map(Number)
    if (h !== undefined && Number.isFinite(h)) props.builder.hour = h
    if (m !== undefined && Number.isFinite(m)) props.builder.minute = m
  },
})

function toggleWeekday(day: number): void {
  props.builder.weekdays = props.builder.weekdays.includes(day)
    ? props.builder.weekdays.filter((d) => d !== day)
    : [...props.builder.weekdays, day]
}
</script>

<template>
  <div v-if="builder.mode === 'weekly'" class="space-y-1.5">
    <Label class="text-muted-foreground text-xs tracking-wide uppercase">Repeats on</Label>
    <div class="flex gap-1.5">
      <button
        v-for="day in WEEKDAY_DISPLAY_ORDER"
        :key="day"
        type="button"
        class="size-9 flex-1 rounded-md border text-xs font-medium transition-colors"
        :class="
          builder.weekdays.includes(day)
            ? 'border-brand bg-brand text-brand-foreground'
            : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        "
        @click="toggleWeekday(day)"
      >
        {{ WEEKDAY_SHORT_LABELS[day] }}
      </button>
    </div>
  </div>

  <div v-else-if="builder.mode === 'monthly'" class="space-y-1.5">
    <Label class="text-muted-foreground text-xs tracking-wide uppercase">Day of month</Label>
    <Input
      type="number"
      min="1"
      max="31"
      :model-value="builder.dayOfMonth"
      @update:model-value="builder.dayOfMonth = Number($event) || 1"
    />
  </div>

  <div v-else-if="builder.mode === 'interval'" class="grid grid-cols-2 gap-3">
    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Every</Label>
      <Input
        type="number"
        min="1"
        :model-value="builder.intervalValue"
        @update:model-value="builder.intervalValue = Number($event) || 1"
      />
    </div>
    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Unit</Label>
      <Select v-model="builder.intervalUnit">
        <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="minutes">Minutes</SelectItem>
            <SelectItem value="hours">Hours</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  </div>

  <div v-else-if="builder.mode === 'custom'" class="space-y-1.5">
    <Label class="text-muted-foreground text-xs tracking-wide uppercase">Cron expression</Label>
    <Input v-model="builder.customExpr" class="font-mono" placeholder="0 8 * * 1-5" />
    <p v-if="!cronValid" class="text-destructive text-xs">Use 5 cron fields, e.g. "0 8 * * 1-5".</p>
  </div>

  <div class="grid" :class="showAtTime ? 'grid-cols-2 gap-3' : 'grid-cols-1'">
    <div v-if="showAtTime" class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">At</Label>
      <Input v-model="atTime" type="time" />
    </div>
    <div class="space-y-1.5">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Timezone</Label>
      <Select :model-value="timezone" @update:model-value="emit('update:timezone', String($event ?? ''))">
        <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="tz in timezoneOptions" :key="tz" :value="tz">{{ tz }}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
