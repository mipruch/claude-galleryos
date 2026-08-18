<script setup lang="ts">
/**
 * One line of the provisioning review sheet: the connection's address, the
 * name the device will be created under, and the room it lands in.
 *
 * A blocked candidate (a gateway, an uninstalled driver, an address only the
 * installer knows) renders read-only with the reason attached instead of being
 * dropped from the list — an operator who imported nine connections and is
 * offered seven needs to see which two, and why.
 */
import { computed } from 'vue'
import type { RoomDTO } from '@gallery/types'
import { BLOCK_HINT, BLOCK_LABEL } from '@/lib/deviceProvisioning'
import type { ProvisionCandidate, ProvisionRow } from '@/lib/deviceProvisioning'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ProvisionCheckbox from './ProvisionCheckbox.vue'

const props = defineProps<{
  candidate: ProvisionCandidate
  row: ProvisionRow
  rooms: RoomDTO[]
  /** Sentinel for "no room" — reka-ui forbids an empty `<SelectItem value>`. */
  noneValue: string
}>()

const emit = defineEmits<{
  'update:selected': [boolean]
  'update:name': [string]
  'update:roomId': [string | null]
}>()

/** A selected row with a blank name can't be created — flag the field, not a toast. */
const nameMissing = computed(() => props.row.selected && !props.row.name.trim())

/** "Offline since 12 Aug" when Redis remembers, plain "Offline" when it doesn't. */
const offlineLabel = computed(() => {
  if (!props.candidate.lastSeen) return 'Offline'
  const seen = new Date(props.candidate.lastSeen)
  if (Number.isNaN(seen.getTime())) return 'Offline'
  return `Offline since ${seen.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
})
</script>

<template>
  <div
    class="flex items-center gap-4 border-b px-6 py-2.5"
    :class="candidate.blocked ? 'bg-muted/20' : ''"
    :title="candidate.blocked ? BLOCK_HINT[candidate.blocked] : undefined"
  >
    <ProvisionCheckbox
      :model-value="row.selected"
      :disabled="!!candidate.blocked"
      :label="`Create a device for ${candidate.connectionName}`"
      @update:model-value="emit('update:selected', $event)"
    />

    <span
      class="text-muted-foreground w-44 shrink-0 truncate font-mono text-sm"
      :title="candidate.endpoint"
    >
      {{ candidate.endpoint }}
    </span>

    <!-- Blocked: what it *would* have been called, and why it isn't. -->
    <div v-if="candidate.blocked" class="flex min-w-0 flex-1 items-center gap-2">
      <span class="text-muted-foreground truncate text-sm">{{ candidate.suggestedName }}</span>
      <Badge variant="secondary" class="shrink-0">{{ BLOCK_LABEL[candidate.blocked] }}</Badge>
    </div>

    <div v-else class="flex min-w-0 flex-1 items-center gap-2">
      <Input
        :model-value="row.name"
        :aria-label="`Device name for ${candidate.connectionName}`"
        :class="nameMissing ? 'border-destructive' : ''"
        @update:model-value="emit('update:name', String($event))"
      />
      <Badge
        v-if="!candidate.online"
        variant="secondary"
        class="shrink-0 bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      >
        {{ offlineLabel }}
      </Badge>
    </div>

    <div class="w-44 shrink-0">
      <span
        v-if="candidate.blocked || !row.selected"
        class="text-muted-foreground block px-3 text-sm"
      >
        Skipped
      </span>
      <Select
        v-else
        :model-value="row.roomId ?? noneValue"
        @update:model-value="emit('update:roomId', $event === noneValue ? null : String($event))"
      >
        <SelectTrigger
          :aria-label="`Room for ${candidate.connectionName}`"
          class="w-full"
          :class="row.roomId ? '' : 'border-dashed'"
        >
          <SelectValue placeholder="No room" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="noneValue">No room</SelectItem>
            <SelectItem v-for="room in rooms" :key="room.id" :value="room.id">
              {{ room.name }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  </div>
</template>
