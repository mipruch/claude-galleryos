/**
 * Logs store — backs the admin log viewer and the dashboard's recent-logs panel.
 *
 * The server has no live socket event for logs (the WS contract carries no `log`
 * event), so this is fetch/refresh based: the view re-runs `fetchLogs()` on a
 * manual Refresh or an optional poll. Filter + pagination state lives here so the
 * view stays declarative.
 *
 * `recent` + `fetchRecent()` are a separate, filter-free slice for the dashboard
 * so it never disturbs the viewer's filters.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { Jsonify, LevelCount, LogDTO, SceneExecution } from '@gallery/types'
import { errMsg } from '@/lib/http'
import { api } from '@/lib/api'

type SceneExecutionDTO = Jsonify<SceneExecution>

/** Filter state for the main log table; empty string = "any". */
interface LogFilter {
  level: string
  source: string
  entityId: string
  from: string
  to: string
}

const DEFAULT_LIMIT = 100

export const useLogsStore = defineStore('logs', () => {
  // ── main log table ──────────────────────────────────────────────────────
  const records = ref<LogDTO[]>([])
  const count = ref(0)
  const limit = ref(DEFAULT_LIMIT)
  const offset = ref(0)
  const filter = ref<LogFilter>({ level: '', source: '', entityId: '', from: '', to: '' })
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasPrev = computed(() => offset.value > 0)
  const hasNext = computed(() => offset.value + records.value.length < count.value)

  /** Current filter + page as API params, dropping blank fields. */
  function queryParams(): Parameters<typeof api.logs.list>[0] {
    const active = Object.fromEntries(Object.entries(filter.value).filter(([, v]) => v !== ''))
    return { ...active, limit: limit.value, offset: offset.value }
  }

  /** Loads logs for the current filter + page. Pass `resetPage` to jump to page 1. */
  async function fetchLogs(resetPage = false): Promise<void> {
    if (resetPage) offset.value = 0
    loading.value = true
    error.value = null
    try {
      const res = await api.logs.list(queryParams())
      records.value = res?.logs ?? []
      count.value = res?.count ?? 0
    } catch (err) {
      error.value = errMsg(err)
      toast.error('Could not load logs', { description: error.value })
    } finally {
      loading.value = false
    }
  }

  function nextPage(): void {
    if (!hasNext.value) return
    offset.value += limit.value
    void fetchLogs()
  }

  function prevPage(): void {
    if (!hasPrev.value) return
    offset.value = Math.max(0, offset.value - limit.value)
    void fetchLogs()
  }

  function resetFilter(): void {
    filter.value = { level: '', source: '', entityId: '', from: '', to: '' }
    void fetchLogs(true)
  }

  // ── scene executions tab ──────────────────────────────────────────────────
  const executions = ref<SceneExecutionDTO[]>([])
  const execLoading = ref(false)

  async function fetchExecutions(): Promise<void> {
    execLoading.value = true
    try {
      const res = await api.logs.executions({ limit: 100 })
      executions.value = res?.executions ?? []
    } catch (err) {
      toast.error('Could not load executions', { description: errMsg(err) })
    } finally {
      execLoading.value = false
    }
  }

  // ── stats (dashboard) ─────────────────────────────────────────────────────
  const stats = ref<{ last24h: LevelCount[]; last7d: LevelCount[] } | null>(null)

  async function fetchStats(): Promise<void> {
    try {
      const res = await api.logs.stats()
      if (res) stats.value = { last24h: res.last24h.byLevel, last7d: res.last7d.byLevel }
    } catch {
      // Stats are best-effort on the dashboard; ignore failures.
    }
  }

  // ── recent slice (dashboard) — independent of the table filters ───────────
  const recent = ref<LogDTO[]>([])

  async function fetchRecent(n = 10): Promise<void> {
    try {
      const res = await api.logs.list({ limit: n, offset: 0 })
      recent.value = res?.logs ?? []
    } catch {
      // Best-effort; the dashboard panel just stays empty.
    }
  }

  return {
    records,
    count,
    limit,
    offset,
    filter,
    loading,
    error,
    hasPrev,
    hasNext,
    fetchLogs,
    nextPage,
    prevPage,
    resetFilter,
    executions,
    execLoading,
    fetchExecutions,
    stats,
    fetchStats,
    recent,
    fetchRecent,
  }
})
