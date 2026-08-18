<script setup lang="ts">
/**
 * The scene's stage board — one horizontally-scrolling column per stage
 * (`parallelGroup`), each holding the cards that run concurrently in it.
 * Dragging a card within a column reorders it; dragging across columns
 * (via `vue-draggable-plus`'s shared `group`) re-groups it — both directly
 * splice the bound `stages` arrays, so there's no coordinate math to
 * reconcile back into a group index the way the old canvas editor needed.
 *
 * Stages are a UI grouping only (see `lib/sceneStages.ts`): there's no
 * "stage" entity to name or delete here, just columns over the actions.
 */
import { FlagIcon, LayersIcon, PlusIcon } from '@lucide/vue'
import { VueDraggable } from 'vue-draggable-plus'
import type { SceneStage } from '@/lib/sceneStages'
import { Badge } from '@/components/ui/badge'
import SceneStepCard from './SceneStepCard.vue'

const stages = defineModel<SceneStage[]>({ required: true })
const props = defineProps<{ selectedKey: string | null }>()
const emit = defineEmits<{
  'update:selectedKey': [string | null]
  'add-stage': []
  'add-step': [stageIndex: number]
}>()

const DRAG_GROUP = 'scene-editor-steps'

function select(key: string): void {
  emit('update:selectedKey', key)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center gap-2 px-6 pt-5 pb-3">
      <Badge variant="outline" class="gap-1.5 py-1 uppercase">
        <FlagIcon class="size-3" />
        Scene start
      </Badge>
      <p class="text-muted-foreground text-xs">stages run in order · cards inside a stage run together</p>
    </div>

    <div class="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto px-6 pb-6">
      <div v-for="(stage, stageIndex) in stages" :key="stageIndex" class="flex w-64 shrink-0 flex-col gap-2">
        <div class="flex items-center justify-between px-0.5">
          <span class="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
            <LayersIcon class="size-3.5" />
            Stage {{ stageIndex + 1 }}
          </span>
          <Badge variant="secondary" class="text-[10px]">{{ stage.length }} parallel</Badge>
        </div>

        <VueDraggable
          v-model="stages![stageIndex]!"
          :group="DRAG_GROUP"
          :animation="150"
          ghost-class="opacity-40"
          item-key="key"
          class="flex min-h-12 flex-col gap-2 rounded-lg"
        >
          <div v-for="action in stage" :key="action.key" @click="select(action.key)">
            <SceneStepCard :action="action" :selected="action.key === props.selectedKey" />
          </div>
        </VueDraggable>

        <button
          type="button"
          class="border-muted-foreground/30 text-muted-foreground hover:border-brand hover:text-brand hover:bg-brand/5 flex items-center justify-center gap-1.5 rounded-md border-2 border-dashed py-2 text-xs font-medium transition-colors"
          @click="emit('add-step', stageIndex)"
        >
          <PlusIcon class="size-3.5" />
          Add step
        </button>
      </div>

      <button
        type="button"
        aria-label="Add stage"
        class="border-muted-foreground/30 text-muted-foreground hover:border-brand hover:text-brand hover:bg-brand/5 flex w-32 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-6 text-xs font-medium transition-colors"
        @click="emit('add-stage')"
      >
        <PlusIcon class="size-5" />
        Stage
      </button>
    </div>
  </div>
</template>
