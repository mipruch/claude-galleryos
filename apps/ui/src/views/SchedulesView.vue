<script setup lang="ts">
/**
 * Schedules monitoring view (read-only).
 *
 * Lists every *enabled* schedule with its upcoming run times, soonest first.
 * Times come from the server in UTC and are rendered in the viewer's local time
 * (display-side conversion). There are no controls to create/edit/toggle a
 * schedule here — this page is purely for monitoring; that lives in the admin UI.
 *
 * Schedules have no live socket event, so we re-fetch on an interval and tick a
 * `now` clock so the relative labels ("in 5 min", "tomorrow") stay fresh.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CalendarClockIcon, ClockIcon, HistoryIcon, RefreshCwIcon } from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSchedulesStore } from '@/stores/schedules'
import { useScenesStore } from '@/stores/scenes'
import { formatDateTime, formatRelative, nextRunOf } from '@/lib/schedules'
import { sceneIcon } from '@/lib/scenes'

const store = useSchedulesStore()
const scenes = useScenesStore()

/** Live clock driving the relative labels; ticked every 30s. */
const now = ref(Date.now())

// Re-fetch periodically (next_run_at only changes when a job fires) and tick the
// clock more often so "in N minutes" counts down without a network round-trip.
const REFETCH_MS = 60_000
const TICK_MS = 30_000
let refetch: ReturnType<typeof setInterval> | undefined
let tick: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void store.fetchAll()
  refetch = setInterval(() => void store.fetchAll(), REFETCH_MS)
  tick = setInterval(() => (now.value = Date.now()), TICK_MS)
})
onBeforeUnmount(() => {
  if (refetch) clearInterval(refetch)
  if (tick) clearInterval(tick)
})

const sceneName = (sceneId: string): string =>
  scenes.records.find((s) => s.id === sceneId)?.name ?? 'Unknown scene'
const sceneIconFor = (sceneId: string) =>
  sceneIcon(scenes.records.find((s) => s.id === sceneId)?.icon)

const schedules = computed(() => store.enabledSchedules)
/** Runs after the soonest one — the "then" list shown under the headline run. */
const upcomingTail = (id: string): string[] => store.previewsFor(id).slice(1)
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-6">
    <!-- Body toolbar: count + manual refresh. -->
    <div class="mb-4 flex items-center justify-between">
      <p class="text-muted-foreground text-sm">
        {{ schedules.length }} enabled
        {{ schedules.length === 1 ? 'schedule' : 'schedules' }}
      </p>
      <button
        type="button"
        class="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 disabled:opacity-50"
        :disabled="store.loading"
        aria-label="Refresh schedules"
        @click="store.fetchAll()"
      >
        <RefreshCwIcon class="size-3.5" :class="store.loading ? 'animate-spin' : ''" />
        <span>Refresh</span>
      </button>
    </div>

    <!-- Loading (first load only) -->
    <div
      v-if="store.loading && !store.loaded"
      class="text-muted-foreground flex items-center justify-center py-16 text-sm"
    >
      Loading schedules…
    </div>

    <!-- Error -->
    <div
      v-else-if="store.error && !store.loaded"
      class="text-destructive bg-destructive/10 rounded-lg px-4 py-3 text-sm"
    >
      {{ store.error }}
    </div>

    <!-- Empty -->
    <div
      v-else-if="!schedules.length"
      class="text-muted-foreground flex flex-col items-center justify-center gap-2 py-16 text-center"
    >
      <CalendarClockIcon class="size-8 opacity-40" />
      <p class="text-sm">No enabled schedules.</p>
    </div>

    <!-- Schedule cards, soonest run first -->
    <div v-else class="space-y-4">
      <Card v-for="job in schedules" :key="job.id">
        <CardHeader>
          <div class="flex items-start gap-3">
            <component
              :is="sceneIconFor(job.sceneId)"
              class="text-muted-foreground mt-0.5 size-5 shrink-0"
            />
            <div class="min-w-0 flex-1">
              <CardTitle class="truncate">{{ job.name }}</CardTitle>
              <p class="text-muted-foreground mt-0.5 truncate text-sm">
                Runs <span class="text-foreground">{{ sceneName(job.sceneId) }}</span>
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent class="space-y-3">
          <!-- Headline: the next run -->
          <div class="flex items-baseline gap-2">
            <ClockIcon class="text-muted-foreground size-4 shrink-0 self-center" />
            <template v-if="nextRunOf(job, store.previewsFor(job.id))">
              <span class="font-medium">
                {{ formatRelative(nextRunOf(job, store.previewsFor(job.id)), now) }}
              </span>
              <span class="text-muted-foreground text-sm">
                · {{ formatDateTime(nextRunOf(job, store.previewsFor(job.id))) }}
              </span>
            </template>
            <span v-else class="text-muted-foreground text-sm">No upcoming run</span>
          </div>

          <!-- The runs after the next one -->
          <div v-if="upcomingTail(job.id).length" class="pl-6">
            <p class="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              Then
            </p>
            <ul class="space-y-0.5">
              <li
                v-for="run in upcomingTail(job.id)"
                :key="run"
                class="text-muted-foreground text-sm"
              >
                {{ formatDateTime(run) }}
              </li>
            </ul>
          </div>

          <!-- Cadence + last run -->
          <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs">
            <Tooltip>
              <TooltipTrigger as-child>
                <code class="bg-muted rounded px-1.5 py-0.5 font-mono">{{ job.cron }}</code>
              </TooltipTrigger>
              <TooltipContent>Cron expression ({{ job.timezone }})</TooltipContent>
            </Tooltip>
            <span>{{ job.timezone }}</span>
            <span v-if="job.lastRunAt" class="flex items-center gap-1.5">
              <HistoryIcon class="size-3.5" />
              Last run {{ formatRelative(job.lastRunAt, now) }}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
