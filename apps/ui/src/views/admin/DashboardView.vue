<script setup lang="ts">
/**
 * Admin dashboard (README §10 `/dashboard`). A read-only overview: device
 * online/offline, connection health, running scenes, server uptime/drivers,
 * per-connection status, favourite-scene quick actions, and the latest logs.
 *
 * No live socket for system/logs, so it re-fetches on a light interval; device,
 * connection and scene tiles update live via their already-socketed stores.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { ActivityIcon, CableIcon, MonitorSpeakerIcon, ServerIcon } from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useScenesStore } from '@/stores/scenes'
import { useSystemStore } from '@/stores/system'
import { useLogsStore } from '@/stores/logs'
import { STATE_COLOR, STATE_DOT, STATE_LABEL } from '@/lib/connections'
import { sceneIcon } from '@/lib/scenes'
import { formatLogTime, levelVariant } from '@/lib/logs'
import { formatUptime } from '@/lib/system'

const devices = useDevicesStore()
const connections = useConnectionsStore()
const scenes = useScenesStore()
const system = useSystemStore()
const logs = useLogsStore()

const deviceTotal = computed(() => devices.devices.length)
const deviceOnline = computed(() => devices.devices.filter((d) => devices.statusOf(d.id).online).length)
const runningScenes = computed(() => Object.values(scenes.running).filter(Boolean).length)
const favourites = computed(() => scenes.records.filter((s) => s.isFavorite && s.enabled))

/** Returns non-ok PJLink error entries for a connection's projector, if any. */
function pjlinkErrors(connectionId: string): { key: string; val: string }[] {
  const device = devices.devices.find(
    (d) => d.connectionId === connectionId && d.subtype === 'pjlink.projector',
  )
  if (!device) return []
  const state = devices.stateOf(device.id) as { errors?: Record<string, string> }
  if (!state?.errors) return []
  return Object.entries(state.errors)
    .filter(([, v]) => v && v !== 'ok')
    .map(([k, v]) => ({ key: k, val: v }))
}

const REFRESH_MS = 10_000
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void system.refresh()
  void logs.fetchRecent(10)
  void connections.fetchAll()
  if (!scenes.records.length) void scenes.fetchAll()
  timer = setInterval(() => {
    void system.refresh()
    void logs.fetchRecent(10)
  }, REFRESH_MS)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="space-y-6 px-6 py-6">
    <!-- Stat cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader class="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-muted-foreground text-sm font-medium">Devices online</CardTitle>
          <MonitorSpeakerIcon class="text-muted-foreground size-4" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">{{ deviceOnline }} / {{ deviceTotal }}</div>
          <p class="text-muted-foreground text-xs">{{ deviceTotal - deviceOnline }} offline</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-muted-foreground text-sm font-medium">Connections</CardTitle>
          <CableIcon class="text-muted-foreground size-4" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">
            {{ connections.connectedCount }} / {{ connections.enabledCount }}
          </div>
          <p class="text-muted-foreground text-xs">connected · enabled</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-muted-foreground text-sm font-medium">Active scenes</CardTitle>
          <ActivityIcon class="text-muted-foreground size-4" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">{{ runningScenes }}</div>
          <p class="text-muted-foreground text-xs">{{ scenes.records.length }} total</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-muted-foreground text-sm font-medium">Server</CardTitle>
          <ServerIcon class="text-muted-foreground size-4" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-semibold">{{ formatUptime(system.status?.uptimeMs) }}</div>
          <p class="text-muted-foreground text-xs">
            {{ system.status?.installedDrivers ?? 0 }} drivers · uptime
          </p>
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Favourite scene quick actions -->
      <Card>
        <CardHeader><CardTitle class="text-base">Quick actions</CardTitle></CardHeader>
        <CardContent>
          <div v-if="favourites.length" class="flex flex-wrap gap-2">
            <Button
              v-for="scene in favourites"
              :key="scene.id"
              variant="outline"
              :disabled="scenes.isRunning(scene.id)"
              @click="scenes.execute(scene.id)"
            >
              <component :is="sceneIcon(scene.icon)" class="size-4" />
              {{ scene.name }}
            </Button>
          </div>
          <p v-else class="text-muted-foreground text-sm">No favourite scenes. Star scenes to pin them here.</p>
        </CardContent>
      </Card>

      <!-- Connection status list -->
      <Card>
        <CardHeader><CardTitle class="text-base">Connections</CardTitle></CardHeader>
        <CardContent>
          <ul v-if="connections.connections.length" class="divide-y">
            <li v-for="c in connections.connections" :key="c.id" class="py-2">
              <div class="flex items-center gap-3">
                <span class="size-2 shrink-0 rounded-full" :class="STATE_DOT[c.state]" />
                <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ c.name }}</span>
                <span class="text-muted-foreground shrink-0 text-xs">{{ c.driverId }}</span>
                <span class="shrink-0 text-xs" :class="STATE_COLOR[c.state]">{{ STATE_LABEL[c.state] }}</span>
                <span v-if="c.status.latencyMs != null" class="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {{ c.status.latencyMs }}ms
                </span>
              </div>
              <div v-if="pjlinkErrors(c.id).length" class="mt-1 flex flex-wrap gap-1 pl-5">
                <span
                  v-for="e in pjlinkErrors(c.id)"
                  :key="e.key"
                  class="rounded px-1.5 py-0.5 text-xs font-medium"
                  :class="e.val === 'error' ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-600'"
                >
                  {{ e.key }}: {{ e.val }}
                </span>
              </div>
            </li>
          </ul>
          <p v-else class="text-muted-foreground text-sm">No connections configured.</p>
        </CardContent>
      </Card>
    </div>

    <!-- Recent logs -->
    <Card>
      <CardHeader class="flex-row items-center justify-between space-y-0">
        <CardTitle class="text-base">Recent logs</CardTitle>
        <RouterLink to="/admin/logs" class="text-muted-foreground hover:text-foreground text-xs">
          View all →
        </RouterLink>
      </CardHeader>
      <CardContent>
        <ul v-if="logs.recent.length" class="space-y-1.5">
          <li v-for="log in logs.recent" :key="String(log.id)" class="flex items-center gap-2 text-sm">
            <Badge :variant="levelVariant(log.level)" class="shrink-0">{{ log.level }}</Badge>
            <span class="text-muted-foreground shrink-0 font-mono text-xs">{{ formatLogTime(log.ts) }}</span>
            <span class="text-muted-foreground shrink-0 font-mono text-xs">{{ log.source }}</span>
            <span class="min-w-0 flex-1 truncate">{{ log.message }}</span>
          </li>
        </ul>
        <p v-else class="text-muted-foreground text-sm">No recent logs.</p>
      </CardContent>
    </Card>
  </div>
</template>
