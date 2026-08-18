<script setup lang="ts">
/**
 * Searchable connection picker — the New-device dialog's first field.
 *
 * It replaces a plain `<Select>` that listed every connection by name, which
 * stops working at the scale this app is actually deployed at: on a site with
 * a hundred displays, finding "Iiyama Display Hall 4 Center" meant scrolling a
 * hundred identically-named rows with no addresses to tell them apart. So the
 * list is filtered as you type (name *or* host, since an integrator standing at
 * a rack knows the IP and not the label), and each row carries its endpoint.
 *
 * The list is ordered by what the operator is most likely reaching for:
 * connections that carry no device yet come first, under their own heading with
 * a **Create all** shortcut into the bulk review sheet — because someone who
 * just imported a hundred connections is not opening this dialog a hundred
 * times. Connections that already have devices follow, annotated with how many.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { PlugZapIcon, SearchIcon } from '@lucide/vue'
import type { DeviceDTO } from '@gallery/types'
import type { ConnectionRecord } from '@/lib/connections'
import { endpointLabel } from '@/lib/deviceProvisioning'
import { normalize } from '@/lib/text'

const props = defineProps<{
  modelValue: string
  connections: ConnectionRecord[]
  devices: Pick<DeviceDTO, 'connectionId'>[]
  /** Locks the picker to its current value (a device can't change connection). */
  disabled?: boolean
  /** Hides the "Create all" shortcut where there is nowhere for it to lead. */
  hideProvision?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [string]; provision: [] }>()

const query = ref('')
const searchEl = ref<HTMLInputElement | null>(null)

/** Device count per connection — what distinguishes a fresh socket from a busy one. */
const deviceCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const device of props.devices) {
    counts[device.connectionId] = (counts[device.connectionId] ?? 0) + 1
  }
  return counts
})

interface PickerOption {
  connection: ConnectionRecord
  endpoint: string
  deviceCount: number
}

const options = computed<PickerOption[]>(() => {
  const terms = normalize(query.value).split(/\s+/).filter(Boolean)
  return props.connections
    .map((connection) => ({
      connection,
      endpoint: endpointLabel(connection),
      deviceCount: deviceCounts.value[connection.id] ?? 0,
    }))
    .filter((option) => {
      if (!terms.length) return true
      const haystack = normalize(`${option.connection.name} ${option.endpoint}`)
      return terms.every((term) => haystack.includes(term))
    })
    .sort((a, b) =>
      a.connection.name.localeCompare(b.connection.name, undefined, { numeric: true }),
    )
})

const empty = computed(() => options.value.filter((option) => !option.deviceCount))
const used = computed(() => options.value.filter((option) => option.deviceCount > 0))

/**
 * The list, split into its two headed sections.
 *
 * Both render the same row, so they're one loop rather than two near-identical
 * blocks: the only differences are the heading's emphasis (the bare
 * connections get the brand accent, because they're what this dialog is for)
 * and what the row's right-hand column says.
 */
interface PickerSection {
  id: 'empty' | 'used'
  heading: string
  options: PickerOption[]
  /** Only the "without a device" section leads anywhere in bulk. */
  provisionable: boolean
}
const sections = computed<PickerSection[]>(() =>
  [
    {
      id: 'empty' as const,
      heading: `Without a device · ${empty.value.length}`,
      options: empty.value,
      provisionable: !props.hideProvision && empty.value.length > 1,
    },
    {
      id: 'used' as const,
      // Suppressed when there's nothing above it to distinguish it from.
      heading: empty.value.length ? `Already in use · ${used.value.length}` : '',
      options: used.value,
      provisionable: false,
    },
  ].filter((section) => section.options.length),
)

const selected = computed(() =>
  props.connections.find((connection) => connection.id === props.modelValue),
)

function choose(id: string): void {
  emit('update:modelValue', id)
}

// A locked picker shows only what was chosen, so its search box would be a lie.
watch(
  () => props.disabled,
  (locked) => {
    if (locked) query.value = ''
  },
)

/** Focus the search box when the field first appears — this is where typing starts. */
watch(
  () => props.connections.length,
  async (count, before) => {
    if (before || !count || props.disabled) return
    await nextTick()
    searchEl.value?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <!-- Locked (edit mode): the connection is fixed once a device exists. -->
  <div
    v-if="disabled"
    class="border-input bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
  >
    <PlugZapIcon class="size-4 shrink-0" />
    <span class="text-foreground truncate">{{ selected?.name ?? '—' }}</span>
    <span v-if="selected" class="ml-auto shrink-0 font-mono text-xs">
      {{ endpointLabel(selected) }}
    </span>
  </div>

  <div v-else class="border-input overflow-hidden rounded-md border">
    <div class="flex items-center gap-2 border-b px-3">
      <SearchIcon class="text-muted-foreground size-4 shrink-0" />
      <input
        ref="searchEl"
        v-model="query"
        type="text"
        class="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
        placeholder="Search connections…"
        aria-label="Search connections"
      />
    </div>

    <ul class="max-h-64 overflow-y-auto">
      <template v-for="section in sections" :key="section.id">
        <li
          v-if="section.heading"
          class="sticky top-0 flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-semibold tracking-wide uppercase"
          :class="
            section.id === 'empty' ? 'bg-brand/5 text-brand' : 'bg-muted/50 text-muted-foreground'
          "
        >
          <span>{{ section.heading }}</span>
          <button
            v-if="section.provisionable"
            type="button"
            class="text-xs font-medium normal-case hover:underline"
            @click="emit('provision')"
          >
            Create all
          </button>
        </li>

        <li v-for="option in section.options" :key="option.connection.id">
          <button
            type="button"
            class="hover:bg-accent flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm"
            :class="[
              option.connection.id === modelValue ? 'bg-accent' : '',
              option.deviceCount ? 'text-muted-foreground' : 'font-medium',
            ]"
            @click="choose(option.connection.id)"
          >
            <span class="truncate">{{ option.connection.name }}</span>
            <!-- A bare connection is identified by its address (a hundred are
                 named alike); a busy one by how much already hangs off it. -->
            <span v-if="option.deviceCount" class="shrink-0 text-xs">
              {{ option.deviceCount }} device{{ option.deviceCount === 1 ? '' : 's' }}
            </span>
            <span v-else class="text-muted-foreground shrink-0 font-mono text-xs">
              {{ option.endpoint }}
            </span>
          </button>
        </li>
      </template>

      <li v-if="!options.length" class="text-muted-foreground px-3 py-6 text-center text-sm">
        {{
          connections.length ? 'No connection matches.' : 'No connections yet — create one first.'
        }}
      </li>
    </ul>
  </div>
</template>
