<script setup lang="ts">
/**
 * Admin connections list — every gateway/socket with its live state, plus
 * create/edit/delete. Reuses `useConnectionsStore` (already hydrated + live via
 * the shared socket) so the table reflects realtime status without re-fetching.
 */
import { computed, onMounted, ref } from 'vue'
import { CableIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from '@lucide/vue'
import type { ConnectionView } from '@/stores/connections'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import ConnectionFormDialog from '@/components/admin/ConnectionFormDialog.vue'

const store = useConnectionsStore()
const drivers = useDriversStore()

onMounted(() => {
  store.init()
  drivers.load()
})

const driverName = (id: string) => drivers.get(id)?.name ?? id

const search = ref('')
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return store.connections
  return store.connections.filter((c) => {
    const addr = [c.host, c.port].filter(Boolean).join(':')
    return (
      c.name.toLowerCase().includes(q) ||
      driverName(c.driverId).toLowerCase().includes(q) ||
      addr.toLowerCase().includes(q)
    )
  })
})

const STATE_LABEL: Record<string, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
  disabled: 'Disabled',
}
const stateClass = (s: string): string =>
  s === 'connected'
    ? 'bg-emerald-500'
    : s === 'reconnecting'
      ? 'bg-amber-500'
      : s === 'disabled'
        ? 'bg-muted-foreground'
        : 'bg-destructive'

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<ConnectionView | null>(null)
const toDelete = ref<ConnectionView | null>(null)
// Independent open flag: reka-ui's AlertDialogAction auto-closes on click, so if
// the open state derived from `toDelete` we'd null the target before
// confirmDelete could read it (delete would no-op while the modal closed).
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(c: ConnectionView): void {
  editing.value = c
  formOpen.value = true
}
function askDelete(c: ConnectionView): void {
  toDelete.value = c
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const c = toDelete.value
  deleteOpen.value = false
  if (c) await store.remove(c.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <div class="relative">
          <SearchIcon class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input v-model="search" placeholder="Search connections…" class="w-56 pl-8" />
        </div>
        <p class="text-muted-foreground text-sm">{{ rows.length }} connection(s)</p>
      </div>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New connection
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="w-24">Enabled</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in rows" :key="c.id">
            <TableCell class="font-medium">{{ c.name }}</TableCell>
            <TableCell>
              <Badge variant="secondary">{{ driverName(c.driverId) }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">
              <span v-if="c.host">{{ c.host }}<span v-if="c.port">:{{ c.port }}</span></span>
              <span v-else>—</span>
            </TableCell>
            <TableCell>
              <span class="flex items-center gap-2 text-sm">
                <span class="size-2 rounded-full" :class="stateClass(c.state)" />
                {{ STATE_LABEL[c.state] ?? c.state }}
                <span v-if="c.status.lastError" class="text-destructive truncate" :title="c.status.lastError">
                  · {{ c.status.lastError }}
                </span>
              </span>
            </TableCell>
            <TableCell>
              <Switch :model-value="c.enabled" @update:model-value="store.setEnabled(c.id, $event)" />
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(c)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(c)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!rows.length">
            <TableCell colspan="6" class="text-muted-foreground py-10 text-center">
              <CableIcon class="mx-auto mb-2 size-6 opacity-50" />
              No connections yet. Add one to start talking to a device.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <ConnectionFormDialog v-model:open="formOpen" :connection="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops its driver and removes the connection. Devices that still reference it must be
            deleted first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction class="bg-destructive hover:bg-destructive/90" @click="confirmDelete">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
