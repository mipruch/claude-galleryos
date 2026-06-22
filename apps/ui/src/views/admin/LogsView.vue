<script setup lang="ts">
/**
 * Admin log viewer (README §10 `/logs`). Two tabs:
 *   - Logs: the structured server log with level/source/entity/time filters,
 *     pagination, manual refresh + optional poll, a per-row metadata detail, and
 *     CSV export of the current page.
 *   - Executions: scene-execution history (status, source, duration).
 *
 * Fetch/refresh based — the WS contract carries no log event, so there is no
 * live stream to subscribe to (see PLAN, Priority 5 follow-ups).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DownloadIcon, RefreshCwIcon } from '@lucide/vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useLogsStore } from '@/stores/logs'
import { useScenesStore } from '@/stores/scenes'
import { LOG_LEVELS, formatDuration, formatLogTime, levelVariant, logsToCsv } from '@/lib/logs'

const store = useLogsStore()
const scenes = useScenesStore()

const tab = ref<'logs' | 'executions'>('logs')

// Local input models for the datetime fields (datetime-local values), converted
// to ISO when applied so the store sends UTC instants to the server.
const fromLocal = ref('')
const toLocal = ref('')

const expandedId = ref<string | null>(null)
function toggleRow(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
}

function applyFilters(): void {
  store.filter.from = fromLocal.value ? new Date(fromLocal.value).toISOString() : ''
  store.filter.to = toLocal.value ? new Date(toLocal.value).toISOString() : ''
  void store.fetchLogs(true)
}

function resetFilters(): void {
  fromLocal.value = ''
  toLocal.value = ''
  store.resetFilter()
}

// ── optional polling ────────────────────────────────────────────────────────
const autoPoll = ref(false)
const POLL_MS = 10_000
let poll: ReturnType<typeof setInterval> | undefined
watch(autoPoll, (on) => {
  if (poll) clearInterval(poll)
  poll = on ? setInterval(() => void store.fetchLogs(), POLL_MS) : undefined
})

onMounted(() => {
  void store.fetchLogs(true)
  if (!scenes.records.length) void scenes.fetchAll()
})
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
})

// Load executions lazily the first time that tab is opened.
watch(tab, (t) => {
  if (t === 'executions' && !store.executions.length) void store.fetchExecutions()
})

const rangeLabel = computed(() => {
  const start = store.records.length ? store.offset + 1 : 0
  const end = store.offset + store.records.length
  return `${start}–${end} of ${store.count}`
})

const sceneName = (id: string): string =>
  scenes.records.find((s) => s.id === id)?.name ?? id.slice(0, 8)

function exportCsv(): void {
  const blob = new Blob([logsToCsv(store.records)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gallery-logs-${new Date().toISOString().slice(0, 19)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function execVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed' || status === 'aborted') return 'destructive'
  if (status === 'completed') return 'secondary'
  return 'default'
}
</script>

<template>
  <div class="px-6 py-6">
    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="executions">Executions</TabsTrigger>
      </TabsList>

      <!-- ── Logs ─────────────────────────────────────────────────────────── -->
      <TabsContent value="logs" class="space-y-4">
        <!-- Filter bar -->
        <div class="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div class="space-y-1">
            <Label for="f-level" class="text-xs">Level</Label>
            <select
              id="f-level"
              v-model="store.filter.level"
              class="border-input bg-background h-9 rounded-md border px-2 text-sm outline-none"
            >
              <option value="">Any</option>
              <option v-for="lvl in LOG_LEVELS" :key="lvl" :value="lvl">{{ lvl }}</option>
            </select>
          </div>
          <div class="space-y-1">
            <Label for="f-source" class="text-xs">Source</Label>
            <Input id="f-source" v-model="store.filter.source" placeholder="e.g. scene_engine" class="h-9 w-44" />
          </div>
          <div class="space-y-1">
            <Label for="f-entity" class="text-xs">Entity ID</Label>
            <Input id="f-entity" v-model="store.filter.entityId" placeholder="uuid" class="h-9 w-56" />
          </div>
          <div class="space-y-1">
            <Label for="f-from" class="text-xs">From</Label>
            <Input id="f-from" v-model="fromLocal" type="datetime-local" class="h-9 w-52" />
          </div>
          <div class="space-y-1">
            <Label for="f-to" class="text-xs">To</Label>
            <Input id="f-to" v-model="toLocal" type="datetime-local" class="h-9 w-52" />
          </div>
          <div class="flex gap-2">
            <Button size="sm" :disabled="store.loading" @click="applyFilters">Apply</Button>
            <Button size="sm" variant="outline" :disabled="store.loading" @click="resetFilters">
              Reset
            </Button>
          </div>
        </div>

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-muted-foreground text-sm">{{ rangeLabel }}</p>
          <div class="flex items-center gap-2">
            <Label class="text-muted-foreground text-xs">
              <input v-model="autoPoll" type="checkbox" class="accent-primary" />
              Auto-refresh
            </Label>
            <Button size="sm" variant="outline" :disabled="!store.records.length" @click="exportCsv">
              <DownloadIcon class="size-3.5" /> CSV
            </Button>
            <Button size="sm" variant="outline" :disabled="store.loading" @click="store.fetchLogs()">
              <RefreshCwIcon class="size-3.5" :class="store.loading ? 'animate-spin' : ''" /> Refresh
            </Button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="store.error" class="text-destructive bg-destructive/10 rounded-md px-4 py-3 text-sm">
          {{ store.error }}
        </div>

        <!-- Table -->
        <div class="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-44">Time</TableHead>
                <TableHead class="w-20">Level</TableHead>
                <TableHead class="w-40">Source</TableHead>
                <TableHead class="w-32">Entity</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="log in store.records" :key="String(log.id)">
                <TableRow class="cursor-pointer" @click="toggleRow(String(log.id))">
                  <TableCell class="text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {{ formatLogTime(log.ts) }}
                  </TableCell>
                  <TableCell>
                    <Badge :variant="levelVariant(log.level)">{{ log.level }}</Badge>
                  </TableCell>
                  <TableCell class="font-mono text-xs">{{ log.source }}</TableCell>
                  <TableCell class="text-muted-foreground font-mono text-xs">
                    {{ log.entityType ?? '—' }}
                  </TableCell>
                  <TableCell class="max-w-md truncate">{{ log.message }}</TableCell>
                </TableRow>
                <TableRow v-if="expandedId === String(log.id)" class="bg-muted/30 hover:bg-muted/30">
                  <TableCell colspan="5" class="text-xs">
                    <div class="space-y-1 px-2 py-1">
                      <p v-if="log.entityId">
                        <span class="text-muted-foreground">entity_id:</span>
                        <code class="ml-1">{{ log.entityId }}</code>
                      </p>
                      <p v-if="log.durationMs != null">
                        <span class="text-muted-foreground">duration:</span>
                        <code class="ml-1">{{ formatDuration(log.durationMs) }}</code>
                      </p>
                      <pre class="bg-background overflow-x-auto rounded p-2 font-mono">{{
                        JSON.stringify(log.metadata, null, 2)
                      }}</pre>
                    </div>
                  </TableCell>
                </TableRow>
              </template>
              <TableRow v-if="!store.records.length && !store.loading">
                <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
                  No logs match the current filters.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- Pagination -->
        <div class="flex items-center justify-end gap-2">
          <Button size="sm" variant="outline" :disabled="!store.hasPrev || store.loading" @click="store.prevPage()">
            Previous
          </Button>
          <Button size="sm" variant="outline" :disabled="!store.hasNext || store.loading" @click="store.nextPage()">
            Next
          </Button>
        </div>
      </TabsContent>

      <!-- ── Executions ───────────────────────────────────────────────────── -->
      <TabsContent value="executions" class="space-y-4">
        <div class="flex items-center justify-between">
          <p class="text-muted-foreground text-sm">{{ store.executions.length }} executions</p>
          <Button size="sm" variant="outline" :disabled="store.execLoading" @click="store.fetchExecutions()">
            <RefreshCwIcon class="size-3.5" :class="store.execLoading ? 'animate-spin' : ''" /> Refresh
          </Button>
        </div>

        <div class="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scene</TableHead>
                <TableHead class="w-28">Status</TableHead>
                <TableHead class="w-32">Source</TableHead>
                <TableHead class="w-24">Duration</TableHead>
                <TableHead class="w-44">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="ex in store.executions" :key="ex.id">
                <TableRow class="cursor-pointer" @click="toggleRow(ex.id)">
                  <TableCell class="truncate">{{ sceneName(ex.sceneId) }}</TableCell>
                  <TableCell><Badge :variant="execVariant(ex.status)">{{ ex.status }}</Badge></TableCell>
                  <TableCell class="font-mono text-xs">{{ ex.source }}</TableCell>
                  <TableCell class="text-muted-foreground text-xs">{{ formatDuration(ex.durationMs) }}</TableCell>
                  <TableCell class="text-muted-foreground font-mono text-xs whitespace-nowrap">
                    {{ formatLogTime(ex.startedAt) }}
                  </TableCell>
                </TableRow>
                <TableRow v-if="expandedId === ex.id && ex.errorMessage" class="bg-muted/30 hover:bg-muted/30">
                  <TableCell colspan="5" class="text-destructive text-xs">{{ ex.errorMessage }}</TableCell>
                </TableRow>
              </template>
              <TableRow v-if="!store.executions.length && !store.execLoading">
                <TableCell colspan="5" class="text-muted-foreground py-10 text-center">
                  No scene executions yet.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  </div>
</template>
