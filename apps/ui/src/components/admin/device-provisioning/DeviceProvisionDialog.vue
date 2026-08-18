<script setup lang="ts">
/**
 * "Create devices from connections" — the review sheet behind the bulk flow.
 *
 * Standing up a site means importing connections in bulk (the Connections
 * sheet), and for one-box-per-connection hardware every one of those sockets
 * then needs exactly one device before it can appear on a panel or in a scene.
 * A hundred displays is a hundred identical trips through the New-device
 * dialog, each one a name and a room — which is data the connection already
 * carries. So this lists every device-less connection with its name pre-filled
 * and its room guessed out of that name, and writes the lot in one
 * transactional `POST /bulk/devices`.
 *
 * It is a *review* sheet, not a confirmation: everything is visible and
 * editable before anything is written. Rows are grouped by driver so identical
 * hardware reads as one block, names stay editable inline, rooms can be set per
 * row or assigned to the whole selection at once, and rows that can't be
 * provisioned unattended (a gateway that fans out to many endpoints, an
 * uninstalled driver) are shown greyed with the reason rather than hidden —
 * a silently shorter list is how an operator ends up hunting for the six
 * fixtures that "didn't import".
 *
 * See `lib/deviceProvisioning.ts` for what qualifies and why.
 */
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { MonitorSpeakerIcon, TriangleAlertIcon, XIcon } from '@lucide/vue'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/http'
import {
  buildCandidates,
  buildProvisionPayload,
  groupCandidates,
  initialRows,
  isRowValid,
  type ProvisionCandidate,
  type ProvisionGroup,
  type ProvisionRow,
} from '@/lib/deviceProvisioning'
import { useConnectionsStore } from '@/stores/connections'
import { useDevicesStore } from '@/stores/devices'
import { useDriversStore } from '@/stores/drivers'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ProvisionCheckbox from './ProvisionCheckbox.vue'
import ProvisionRowItem from './ProvisionRowItem.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; created: [number] }>()

const devices = useDevicesStore()
const connections = useConnectionsStore()
const drivers = useDriversStore()

// reka-ui forbids an empty <SelectItem value>, so the two non-room choices use
// sentinels: KEEP leaves each row's own guess alone, NONE clears it.
const KEEP = '__keep__'
const NONE = '__none__'

const candidates = ref<ProvisionCandidate[]>([])
const rows = ref<ProvisionRow[]>([])
const saving = ref(false)
const bulkRoom = ref(KEEP)

const groups = computed(() => groupCandidates(candidates.value))
const rowOf = computed(() => new Map(rows.value.map((row) => [row.connectionId, row])))

/** A group's candidates already paired with their edit state — what the sheet renders. */
interface ProvisionEntry {
  candidate: ProvisionCandidate
  row: ProvisionRow
}
const sections = computed(() =>
  groups.value.map((group) => ({
    ...group,
    entries: group.candidates
      .map((candidate) => ({ candidate, row: rowOf.value.get(candidate.connectionId) }))
      .filter((entry): entry is ProvisionEntry => !!entry.row),
  })),
)
const candidateOf = computed(
  () => new Map(candidates.value.map((candidate) => [candidate.connectionId, candidate])),
)

const eligible = computed(() => candidates.value.filter((candidate) => !candidate.blocked))
const selectedRows = computed(() =>
  rows.value.filter(
    (row) => row.selected && isRowValid(row, candidateOf.value.get(row.connectionId)),
  ),
)
const selectedCount = computed(() => selectedRows.value.length)
/** Selected rows whose name was cleared — the only way this sheet can be invalid. */
const namelessCount = computed(
  () => rows.value.filter((row) => row.selected && !row.name.trim()).length,
)

const allSelected = computed(
  () => eligible.value.length > 0 && selectedCount.value === eligible.value.length,
)

function hydrate(): void {
  candidates.value = buildCandidates(
    connections.connections,
    devices.records,
    (driverId) => drivers.get(driverId),
    devices.rooms,
    (connectionId) => connections.statuses[connectionId],
  )
  rows.value = initialRows(candidates.value)
  bulkRoom.value = KEEP
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await Promise.all([drivers.load(), connections.init(), devices.init()])
    hydrate()
  },
  { immediate: true },
)

// ── selection ───────────────────────────────────────────────────────────────

/** Set the selection over a subset of rows — the header and per-group controls. */
function selectMany(connectionIds: Set<string> | null, value: boolean): void {
  for (const row of rows.value) {
    if (connectionIds && !connectionIds.has(row.connectionId)) continue
    if (candidateOf.value.get(row.connectionId)?.blocked) continue
    row.selected = value
  }
}

function selectGroup(group: ProvisionGroup): void {
  const ids = new Set(group.candidates.map((candidate) => candidate.connectionId))
  // A group whose rows are already all selected toggles back off — one control,
  // both directions, which is what a repeated click means.
  const groupRows = rows.value.filter(
    (row) => ids.has(row.connectionId) && !candidateOf.value.get(row.connectionId)?.blocked,
  )
  selectMany(ids, !groupRows.every((row) => row.selected))
}

const groupSelectable = (group: ProvisionGroup): boolean =>
  group.candidates.some((candidate) => !candidate.blocked)

// ── room assignment ─────────────────────────────────────────────────────────

/**
 * Apply one room to every selected row.
 *
 * `KEEP` is the resting position rather than a room: it means each row holds
 * the room guessed from its own name, which is right far more often than any
 * single room would be. Choosing an actual room is the override for a batch
 * that all lands in one place.
 *
 * The control springs back to `KEEP` after each use, which makes it an
 * *action* rather than a setting — otherwise re-picking the same room after
 * changing the selection would be a no-op (the value never changed) and look
 * broken.
 */
watch(bulkRoom, (value) => {
  if (value === KEEP) return
  const roomId = value === NONE ? null : value
  for (const row of rows.value) {
    if (row.selected) row.roomId = roomId
  }
  bulkRoom.value = KEEP
})

/** Apply one row component's edit back onto the sheet's state. */
function patchRow(row: ProvisionRow, patch: Partial<ProvisionRow>): void {
  Object.assign(row, patch)
}

// ── save ────────────────────────────────────────────────────────────────────

async function submit(): Promise<void> {
  const payload = buildProvisionPayload(rows.value, candidates.value)
  if (!payload.length || saving.value) return
  saving.value = true
  try {
    const result = await api.bulk.applyDevices({ rows: payload })
    if (!result) return
    if (!result.ok) {
      toast.error(`${result.errors.length} problem(s) — nothing was created`, {
        description: result.errors[0]?.message,
      })
      return
    }
    toast.success(`Created ${result.created} device${result.created === 1 ? '' : 's'}`)
    await Promise.all([devices.fetchAll(), connections.fetchAll()])
    emit('created', result.created)
    emit('update:open', false)
  } catch (err) {
    toast.error('Could not create devices', { description: errMsg(err) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      hide-close
      class="flex max-h-[88vh] w-[96vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1100px]"
    >
      <!-- Header -->
      <div class="flex shrink-0 items-start justify-between gap-4 px-6 py-5">
        <div class="flex min-w-0 gap-3">
          <div
            class="bg-brand/10 text-brand flex size-10 shrink-0 items-center justify-center rounded-lg"
          >
            <MonitorSpeakerIcon class="size-5" />
          </div>
          <div class="min-w-0">
            <DialogTitle class="text-xl leading-tight font-semibold">
              Create devices from connections
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm">
              {{ candidates.length }} connection{{ candidates.length === 1 ? '' : 's' }}
              {{ candidates.length === 1 ? 'has' : 'have' }} no device yet. Each one below becomes a
              single addressable endpoint you can use in scenes.
            </DialogDescription>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          @click="emit('update:open', false)"
        >
          <XIcon class="size-4" />
        </Button>
      </div>

      <!-- Selection + bulk room assignment -->
      <div class="flex flex-wrap items-center gap-3 border-y px-6 py-3">
        <ProvisionCheckbox
          :model-value="allSelected"
          :indeterminate="selectedCount > 0 && !allSelected"
          :disabled="!eligible.length"
          label="Select every connection"
          @update:model-value="selectMany(null, $event)"
        />
        <span class="text-sm font-medium">
          {{ selectedCount }} of {{ eligible.length }} selected
        </span>
        <span class="text-muted-foreground">|</span>
        <button
          type="button"
          class="text-sm font-medium hover:underline"
          @click="selectMany(null, true)"
        >
          Select all
        </button>
        <button
          type="button"
          class="text-muted-foreground text-sm font-medium hover:underline"
          @click="selectMany(null, false)"
        >
          None
        </button>

        <div class="ml-auto flex items-center gap-2">
          <span class="text-muted-foreground text-sm">Assign room</span>
          <Select v-model="bulkRoom">
            <SelectTrigger class="w-44"><SelectValue placeholder="From name" /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem :value="KEEP">From name</SelectItem>
                <SelectItem :value="NONE">No room</SelectItem>
                <SelectItem v-for="room in devices.rooms" :key="room.id" :value="room.id">
                  {{ room.name }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <!-- The sheet itself -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        <template v-for="group in sections" :key="group.driverId">
          <div class="bg-muted/40 flex items-center gap-3 border-b px-6 py-2">
            <span class="text-sm font-semibold tracking-wide uppercase">{{
              group.driverName
            }}</span>
            <span class="text-muted-foreground text-sm">
              {{ group.candidates.length }} connection{{
                group.candidates.length === 1 ? '' : 's'
              }}
              · {{ group.kindLabel }}
            </span>
            <button
              v-if="groupSelectable(group)"
              type="button"
              class="text-brand ml-auto text-sm font-medium hover:underline"
              @click="selectGroup(group)"
            >
              Select group
            </button>
          </div>

          <ProvisionRowItem
            v-for="entry in group.entries"
            :key="entry.candidate.connectionId"
            :candidate="entry.candidate"
            :row="entry.row"
            :rooms="devices.rooms"
            :none-value="NONE"
            @update:selected="patchRow(entry.row, { selected: $event })"
            @update:name="patchRow(entry.row, { name: $event })"
            @update:room-id="patchRow(entry.row, { roomId: $event })"
          />
        </template>

        <p v-if="!candidates.length" class="text-muted-foreground px-6 py-12 text-center text-sm">
          Every connection already has a device.
        </p>
      </div>

      <!-- Footer -->
      <div class="flex shrink-0 flex-wrap items-center gap-3 border-t px-6 py-4">
        <p v-if="namelessCount" class="text-destructive flex items-center gap-1.5 text-sm">
          <TriangleAlertIcon class="size-4" />
          {{ namelessCount }} selected row(s) need a name.
        </p>
        <p v-else class="text-muted-foreground text-sm">
          Rooms guessed from connection names · nothing is created until you confirm
        </p>
        <div class="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" @click="emit('update:open', false)"
            >Cancel</Button
          >
          <Button
            type="button"
            :disabled="!selectedCount || !!namelessCount || saving"
            @click="submit"
          >
            {{
              saving
                ? 'Creating…'
                : `Create ${selectedCount} device${selectedCount === 1 ? '' : 's'}`
            }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
