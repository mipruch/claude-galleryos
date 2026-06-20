<script setup lang="ts">
/**
 * Scene buttons, pinned above the device grid. Shows the scenes relevant to the
 * current view — all scenes by default, or just the selected room's scenes when a
 * room filter is active, or the matches while searching (the scenes store derives
 * `visibleScenes` from the shared grid filter/search). One tap runs the scene; a
 * spinner shows while it's executing. Each button carries the scene description as
 * a tooltip, and uses a Lucide icon mapped from the DB `icon` name.
 */
import { Loader2Icon } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { sceneIcon } from '@/lib/scenes'
import { useScenesStore } from '@/stores/scenes'

const scenes = useScenesStore()
</script>

<template>
  <section v-if="scenes.visibleScenes.length" class="mb-6">
    <h2 class="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Scenes</h2>
    <div class="flex flex-wrap gap-2">
      <Tooltip v-for="scene in scenes.visibleScenes" :key="scene.id">
        <TooltipTrigger
          type="button"
          :disabled="scenes.isRunning(scene.id)"
          :aria-label="`Run scene ${scene.name}`"
          class="border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-60"
          @click="scenes.execute(scene.id)"
        >
          <Loader2Icon v-if="scenes.isRunning(scene.id)" class="size-4 shrink-0 animate-spin" />
          <component
            :is="sceneIcon(scene.icon)"
            v-else
            class="size-4 shrink-0"
            :style="scene.color ? { color: scene.color } : undefined"
          />
          <span class="truncate">{{ scene.name }}</span>
        </TooltipTrigger>
        <TooltipContent v-if="scene.description">
          {{ scene.description }}
        </TooltipContent>
      </Tooltip>
    </div>
  </section>
</template>
