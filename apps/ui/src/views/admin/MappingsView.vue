<script setup lang="ts">
/**
 * Admin mappings list — every input-mapping rule (OSC/TCP/HTTP signal → action)
 * with its protocol, pattern and resolved target, plus enable/disable, edit,
 * delete, and a "Test signal" dry-run. Reuses `useMappingsStore`; scene/device
 * names are resolved from their stores for the target column.
 */
import { onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, Trash2Icon, WaypointsIcon, ZapIcon } from '@lucide/vue'
import type { InputMappingDTO } from '@gallery/types'
import { useMappingsStore } from '@/stores/mappings'
import { useScenesStore } from '@/stores/scenes'
import { useDevicesStore } from '@/stores/devices'
import { protocolLabel, targetSummary } from '@/lib/mappings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import MappingFormDialog from '@/components/admin/MappingFormDialog.vue'
import MappingTestDialog from '@/components/admin/MappingTestDialog.vue'

const store = useMappingsStore()
const scenes = useScenesStore()
const devices = useDevicesStore()

onMounted(() => {
  store.fetchAll()
  scenes.fetchAll()
  devices.fetchAll()
})

/** Human description of a rule's target, with names resolved from the stores. */
function describe(m: InputMappingDTO): string {
  return targetSummary(m.targetType, {
    sceneName: m.targetId ? scenes.records.find((s) => s.id === m.targetId)?.name : undefined,
    deviceName: m.targetId ? devices.records.find((d) => d.id === m.targetId)?.name : undefined,
    command: m.targetCommand,
  })
}

// ── dialog + delete state ───────────────────────────────────────────────────
const formOpen = ref(false)
const testOpen = ref(false)
const editing = ref<InputMappingDTO | null>(null)
const toDelete = ref<InputMappingDTO | null>(null)
const deleteOpen = ref(false)

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}
function openEdit(m: InputMappingDTO): void {
  editing.value = m
  formOpen.value = true
}
function askDelete(m: InputMappingDTO): void {
  toDelete.value = m
  deleteOpen.value = true
}
async function confirmDelete(): Promise<void> {
  const m = toDelete.value
  deleteOpen.value = false
  if (m) await store.remove(m.id)
  toDelete.value = null
}
</script>

<template>
  <div class="flex flex-col gap-4 p-6">
    <div class="flex items-center justify-between gap-4">
      <p class="text-muted-foreground text-sm">{{ store.records.length }} mapping(s)</p>
      <div class="flex gap-2">
        <Button variant="outline" @click="testOpen = true">
          <ZapIcon class="size-4" />
          Test signal
        </Button>
        <Button @click="openCreate">
          <PlusIcon class="size-4" />
          New mapping
        </Button>
      </div>
    </div>

    <div class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead class="w-24">Protocol</TableHead>
            <TableHead>Pattern</TableHead>
            <TableHead>Target</TableHead>
            <TableHead class="w-24">Enabled</TableHead>
            <TableHead class="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="m in store.records" :key="m.id">
            <TableCell class="font-medium">{{ m.name }}</TableCell>
            <TableCell><Badge variant="secondary">{{ protocolLabel(m.protocol) }}</Badge></TableCell>
            <TableCell class="font-mono text-xs">{{ m.pattern }}</TableCell>
            <TableCell class="text-muted-foreground">{{ describe(m) }}</TableCell>
            <TableCell>
              <Switch :model-value="m.enabled" @update:model-value="store.toggle(m.id, $event)" />
            </TableCell>
            <TableCell class="text-right">
              <div class="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" @click="openEdit(m)">
                  <PencilIcon class="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Delete" @click="askDelete(m)">
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>

          <TableRow v-if="!store.records.length">
            <TableCell colspan="6" class="text-muted-foreground py-10 text-center">
              <WaypointsIcon class="mx-auto mb-2 size-6 opacity-50" />
              No mappings yet. Create one to drive scenes or devices from OSC/TCP/HTTP.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <MappingFormDialog v-model:open="formOpen" :mapping="editing" />
    <MappingTestDialog v-model:open="testOpen" />

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{{ toDelete?.name }}”?</AlertDialogTitle>
          <AlertDialogDescription>This removes the rule; incoming signals will no longer match it.</AlertDialogDescription>
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
