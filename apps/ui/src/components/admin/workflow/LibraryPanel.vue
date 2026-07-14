<script setup lang="ts">
/**
 * Left sidebar of the workflow routing map: every scene/device, as draggable
 * cards — the library never empties, since dropping one onto the canvas
 * always places a brand new `workflow_targets` instance (never "moves" an
 * existing one), so the same scene/device can be dropped again for a second,
 * independently-configured node. See `WorkflowsView`'s drop handler.
 *
 * The search box filters both sections by name, reusing the same
 * diacritic-folding, multi-term matching (`lib/text.ts`) the device grid and
 * scene list search already use, for consistent search behaviour app-wide.
 */
import { computed, ref } from 'vue'
import { MonitorSpeakerIcon, SearchIcon, SparklesIcon } from '@lucide/vue'
import type { DeviceDTO, SceneDTO } from '@gallery/types'
import { matchesAllTerms, normalize, searchTerms } from '@/lib/text'
import { Input } from '@/components/ui/input'
import LibraryList from './LibraryList.vue'

const props = defineProps<{ scenes: SceneDTO[]; devices: DeviceDTO[] }>()

const search = ref('')
const terms = computed(() => searchTerms(search.value))
const searching = computed(() => terms.value.length > 0)

const byName = <T extends { name: string }>(items: readonly T[]): T[] =>
  searching.value ? items.filter((item) => matchesAllTerms(normalize(item.name), terms.value)) : [...items]

const filteredScenes = computed(() => byName(props.scenes))
const filteredDevices = computed(() => byName(props.devices))

const sceneEmptyText = computed(() => (searching.value ? 'No scenes match your search' : 'No scenes yet'))
const deviceEmptyText = computed(() => (searching.value ? 'No devices match your search' : 'No devices yet'))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <p class="text-sm font-medium">Library</p>
      <p class="text-muted-foreground text-xs">Drag onto the canvas to place</p>
    </div>

    <div class="relative">
      <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input v-model="search" placeholder="Search…" aria-label="Search library" class="h-8 pl-8 text-sm" />
    </div>

    <LibraryList kind="scene" title="Scenes" :empty-text="sceneEmptyText" :items="filteredScenes" :icon="SparklesIcon" />
    <LibraryList kind="device" title="Devices" :empty-text="deviceEmptyText" :items="filteredDevices" :icon="MonitorSpeakerIcon" />
  </div>
</template>
