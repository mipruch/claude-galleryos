<script setup lang="ts">
/**
 * Left sidebar of the workflow routing map: every scene/device, as draggable
 * cards — the library never empties, since dropping one onto the canvas
 * always places a brand new `workflow_targets` instance (never "moves" an
 * existing one), so the same scene/device can be dropped again for a second,
 * independently-configured node. See `WorkflowsView`'s drop handler.
 *
 * A Scenes/Devices segmented tab (the same brand-coloured pattern the scene
 * editor's Device-command/Run-scene toggle uses) picks which kind's list is
 * shown, grouped by room (`lib/scenes.ts`'s `groupScenesByRoom` / the room
 * level of `lib/devices.ts`'s grouping, exported as `byRoom`) — the same
 * room-first browsing model the device grid and scene list already use
 * elsewhere. A "Recent" shelf below it surfaces whichever of the active
 * kind were most recently dragged onto the canvas (`lib/recentLibraryItems.ts`,
 * a small `localStorage` list `WorkflowsView`'s drop handler appends to),
 * hidden while actively searching since it's a browse convenience, not a
 * search result.
 *
 * The search box filters both kinds by name *and* room (`lib/scenes.ts` /
 * `lib/devices.ts`'s shared search helpers — the same diacritic-folding,
 * multi-term matching the device grid and scene list search already use).
 */
import { computed, ref } from 'vue'
import { MonitorSpeakerIcon, SearchIcon, SparklesIcon } from '@lucide/vue'
import type { DeviceDTO, RoomDTO, SceneDTO } from '@gallery/types'
import { byRoom, searchDevices } from '@/lib/devices'
import { groupScenesByRoom, searchScenes } from '@/lib/scenes'
import { searchTerms } from '@/lib/text'
import { recentLibraryItemIds } from '@/lib/recentLibraryItems'
import { Input } from '@/components/ui/input'
import LibraryList from './LibraryList.vue'

const props = defineProps<{ scenes: SceneDTO[]; devices: DeviceDTO[]; rooms: RoomDTO[] }>()

const activeKind = ref<'scene' | 'device'>('scene')
const search = ref('')
const searching = computed(() => searchTerms(search.value).length > 0)

const filteredScenes = computed(() => searchScenes(props.scenes, search.value, props.rooms))
const filteredDevices = computed(() => searchDevices(props.devices, search.value, props.rooms))

const sceneGroups = computed(() =>
  groupScenesByRoom(filteredScenes.value, props.rooms)
    .filter((g) => g.scenes.length)
    .map((g) => ({ key: g.key, title: g.title, items: g.scenes })),
)
const deviceGroups = computed(() =>
  byRoom(filteredDevices.value, props.rooms)
    .filter((g) => g.devices.length)
    .map((g) => ({ key: g.key, title: g.title ?? 'Unassigned', items: g.devices })),
)

const activeGroups = computed(() => (activeKind.value === 'scene' ? sceneGroups.value : deviceGroups.value))
const hasResults = computed(() => activeGroups.value.some((g) => g.items.length))
const emptyText = computed(() =>
  searching.value
    ? `No ${activeKind.value === 'scene' ? 'scenes' : 'devices'} match your search`
    : `No ${activeKind.value === 'scene' ? 'scenes' : 'devices'} yet`,
)

const recentItems = computed(() => {
  if (searching.value) return []
  const ids = recentLibraryItemIds(activeKind.value)
  const source = activeKind.value === 'scene' ? props.scenes : props.devices
  return ids.map((id) => source.find((item) => item.id === id)).filter((item): item is SceneDTO | DeviceDTO => !!item)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <p class="text-sm font-medium">Library</p>
      <p class="text-muted-foreground text-xs">Drag onto the canvas to add an action, or drop it on a trigger to wire it straight away.</p>
    </div>

    <div class="relative">
      <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input v-model="search" placeholder="Search scenes & devices…" aria-label="Search library" class="h-8 pl-8 text-sm" />
    </div>

    <div class="border-input flex w-full rounded-md border p-0.5 text-sm">
      <button
        type="button"
        class="flex-1 rounded-sm px-2.5 py-1 text-center font-medium transition-colors"
        :class="activeKind === 'scene' ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="activeKind = 'scene'"
      >
        Scenes
      </button>
      <button
        type="button"
        class="flex-1 rounded-sm px-2.5 py-1 text-center font-medium transition-colors"
        :class="activeKind === 'device' ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'"
        @click="activeKind = 'device'"
      >
        Devices
      </button>
    </div>

    <p v-if="!hasResults" class="text-muted-foreground text-xs">{{ emptyText }}</p>
    <LibraryList
      v-for="group in activeGroups"
      :key="group.key"
      :kind="activeKind"
      :title="group.title"
      :empty-text="emptyText"
      :items="group.items"
      :icon="activeKind === 'scene' ? SparklesIcon : MonitorSpeakerIcon"
    />

    <LibraryList
      v-if="recentItems.length"
      :kind="activeKind"
      :title="`Recent ${activeKind === 'scene' ? 'scenes' : 'devices'}`"
      empty-text=""
      :items="recentItems"
      :icon="activeKind === 'scene' ? SparklesIcon : MonitorSpeakerIcon"
    />
  </div>
</template>
