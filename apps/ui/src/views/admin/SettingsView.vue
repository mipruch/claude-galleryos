<script setup lang="ts">
/**
 * Admin settings — the configuration/info surface that isn't operational
 * monitoring (that's the dashboard). Three sections, all backed by real state:
 *
 *   - Appearance: the persisted theme preference (`useThemeStore`).
 *   - System: live status / uptime / counts from `GET /system/*`.
 *   - Installed drivers: the manifest catalogue (`GET /drivers`) joined with
 *     each driver's per-connection runtime status (`GET /system/drivers`).
 *
 * Editable server config (ports, watchdog, retention), driver reload and
 * backup/restore are intentionally absent until the backend exposes them.
 */
import { computed, onMounted } from 'vue'
import { RefreshCwIcon } from '@lucide/vue'
import { useThemeStore, type ThemePref } from '@/stores/theme'
import { useSystemStore } from '@/stores/system'
import { useDriversStore } from '@/stores/drivers'
import { formatUptime, capabilityLabels } from '@/lib/system'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const theme = useThemeStore()
const system = useSystemStore()
const drivers = useDriversStore()

onMounted(() => {
  void system.refresh()
  void drivers.load()
})

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const healthy = computed(() => (system.status?.status ?? '').toLowerCase() === 'ok')

/** Per-driver runtime rollup across the connections that use it. */
const driverRows = computed(() =>
  [...drivers.manifests]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => {
      const runtimes = system.drivers.filter((d) => d.driverId === m.id)
      return {
        manifest: m,
        connections: runtimes.length,
        connected: runtimes.filter((d) => d.connected).length,
        commands: m.endpointTypes.reduce((sum, e) => sum + e.commands.length, 0),
      }
    }),
)
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- Appearance -->
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>How the admin portal looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center justify-between gap-4">
          <div>
            <Label>Theme</Label>
            <p class="text-muted-foreground text-sm">Saved in this browser. “System” follows your OS setting.</p>
          </div>
          <Select :model-value="theme.theme" @update:model-value="theme.setTheme($event as ThemePref)">
            <SelectTrigger class="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="o in THEME_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    <!-- System -->
    <Card>
      <CardHeader class="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>System</CardTitle>
          <CardDescription>Server health and runtime totals.</CardDescription>
        </div>
        <Button variant="outline" size="sm" :disabled="system.loading" @click="system.refresh()">
          <RefreshCwIcon class="size-4" :class="{ 'animate-spin': system.loading }" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <dl class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt class="text-muted-foreground text-sm">Status</dt>
            <dd class="mt-1">
              <Badge :variant="healthy ? 'default' : 'destructive'">{{ system.status?.status ?? 'unknown' }}</Badge>
            </dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm">Uptime</dt>
            <dd class="mt-1 text-2xl font-semibold">{{ formatUptime(system.status?.uptimeMs) }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm">Installed drivers</dt>
            <dd class="mt-1 text-2xl font-semibold">{{ system.status?.installedDrivers ?? 0 }}</dd>
          </div>
          <div>
            <dt class="text-muted-foreground text-sm">Connections</dt>
            <dd class="mt-1 text-2xl font-semibold">
              {{ system.status?.connections.connected ?? 0 }}/{{ system.status?.connections.running ?? 0 }}
            </dd>
            <p class="text-muted-foreground text-xs">connected / running</p>
          </div>
        </dl>
      </CardContent>
    </Card>

    <!-- Installed drivers -->
    <Card>
      <CardHeader>
        <CardTitle>Installed drivers</CardTitle>
        <CardDescription>Drivers available to connections, from their manifests.</CardDescription>
      </CardHeader>
      <CardContent class="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Driver</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead class="text-right">Endpoints</TableHead>
              <TableHead class="text-right">Commands</TableHead>
              <TableHead class="text-right">In use</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in driverRows" :key="row.manifest.id">
              <TableCell class="font-medium">
                {{ row.manifest.name }}
                <span class="text-muted-foreground block font-mono text-xs">{{ row.manifest.id }}</span>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ row.manifest.vendor }}</TableCell>
              <TableCell class="text-muted-foreground">{{ row.manifest.version }}</TableCell>
              <TableCell>
                <div class="flex flex-wrap gap-1">
                  <Badge v-for="cap in capabilityLabels(row.manifest)" :key="cap" variant="secondary">{{ cap }}</Badge>
                  <span v-if="!capabilityLabels(row.manifest).length" class="text-muted-foreground text-sm">—</span>
                </div>
              </TableCell>
              <TableCell class="text-right">{{ row.manifest.endpointTypes.length }}</TableCell>
              <TableCell class="text-right">{{ row.commands }}</TableCell>
              <TableCell class="text-muted-foreground text-right">
                <span v-if="row.connections">{{ row.connected }}/{{ row.connections }} conn</span>
                <span v-else>—</span>
              </TableCell>
            </TableRow>

            <TableRow v-if="!driverRows.length">
              <TableCell colspan="7" class="text-muted-foreground py-10 text-center">No drivers installed.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>
