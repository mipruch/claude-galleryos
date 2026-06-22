<script setup lang="ts">
/**
 * Admin devices list — every endpoint with its connection, room, live online
 * dot, plus create/edit/delete. Reuses `useDevicesStore` (hydrated + live via
 * the shared socket app-wide), filtered by room/type client-side.
 */
import { computed, onMounted, ref } from 'vue'
import { MonitorSpeakerIcon, PencilIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import type { DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import DeviceFormDialog from '@/components/admin/DeviceFormDialog.vue'

const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()

onMounted(() => {
  devices.init()
  connections.init()
  drivers.load()
})

const roomName = (id: string | null) => (id ? (devices.rooms.find((r) => r.id === id)?.name ?? '—') : '—')
const connName = (id: string) => connections.connections.find((c) => c.id === id)?.name ?? id
const types = computed(() => [...new Set(devices.records.map((d) => d.type))].sort())

// reka-ui forbids an empty-string <SelectItem value> (it's reserved for clearing),
// so "all" uses a sentinel the filters treat as "no filter".
const ALL = '__all__'
const roomFilter = ref(ALL)
const typeFilter = ref(ALL)

const rows = computed(() =>
  [...devices.records]
    .filter((d) => (roomFilter.value !== ALL ? d.roomId === roomFilter.value : true))
    .filter((d) => (typeFilter.value !== ALL ? d.type === typeFilter.value : true))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<DeviceRecord | null>(null)
const toDelete = ref<DeviceRecord | null>(null)
const deleteOpen = computed({ get: () => !!toDelete.value, set: (v) => !v && (toDelete.value = null) })

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(d: DeviceRecord): void {
  editing.value = d
  formOpen.value = true
}
async function confirmDelete(): Promise<void> {
  if (toDelete.value && (await devices.removeDevice(toDelete.value.id))) toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <Select v-model="roomFilter">
          <SelectTrigger class="w-44"><SelectValue placeholder="All rooms" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="ALL">All rooms</SelectItem>
              <SelectItem v-for="r in devices.rooms" :key="r.id" :value="r.id">{{ r.name }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select v-model="typeFilter">
          <SelectTrigger class="w-44"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="ALL">All types</SelectItem>
              <SelectItem v-for="t in types" :key="t" :value="t">{{ t }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <Button @click="openCreate">
        <PlusIcon class="size-4" />
        New device
      </Button>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Room</TableHead>
            <TableHead>Connection</TableHead>
            <TableHead>Online</TableHead>
            <TableHead class="w-24">Enabled</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="d in rows" :key="d.id">
            <TableCell class="font-medium">
              {{ d.name }}
              <span v-if="d.subtype" class="text-muted-foreground block text-xs">{{ d.subtype }}</span>
            </TableCell>
            <TableCell><Badge variant="secondary">{{ d.type }}</Badge></TableCell>
            <TableCell class="text-muted-foreground">{{ roomName(d.roomId) }}</TableCell>
            <TableCell class="text-muted-foreground">{{ connName(d.connectionId) }}</TableCell>
            <TableCell>
              <span
                class="size-2 rounded-full inline-block"
                :class="devices.statusOf(d.id)?.online ? 'bg-emerald-500' : 'bg-muted-foreground'"
              />
            </TableCell>
            <TableCell>
              <Switch
                :model-value="d.enabled"
                @update:model-value="devices.updateDevice(d.id, { enabled: $event })"
              />
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(d)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="toDelete = d">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!rows.length">
            <TableCell colspan="7" class="text-muted-foreground py-10 text-center">
              <MonitorSpeakerIcon class="mx-auto mb-2 size-6 opacity-50" />
              No devices match. Add one, or create a connection first.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <DeviceFormDialog v-model:open="formOpen" :device="editing" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This permanently removes the device endpoint.</AlertDialogDescription>
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
