<script setup lang="ts">
/**
 * Routing-map edge for a wired trigger action — a pure link with nothing of
 * its own to configure (see `workflowGraph.ts`'s module doc), so unlike the
 * old edge-driven canvas, clicking it opens nothing. Hovering (or selecting)
 * it instead reveals: the named signal args its owning mapping's pattern
 * captures, if any (`data.signalArgs`, e.g. a `/dim/:level` pattern shows
 * "level" — the same args its target's inspector lists as available to
 * template against), and an inline delete button. Self-contained: deleting
 * here needs no parent notification, since no inspector is ever tied to an
 * edge's selection state.
 *
 * The overlay is an `EdgeLabelRenderer` div — a separate DOM subtree from the
 * SVG path it's positioned over, floating in a layer above it — so a pointer
 * crossing from the path onto the overlay can cross a gap the path's own
 * `hovered` prop doesn't cover, flipping it false and hiding the overlay
 * (and its button) out from under the pointer before a click lands. Tracking
 * a second, local `overlayHovered` flag and OR-ing it into `showOverlay`
 * keeps the overlay up for as long as the pointer is anywhere on either
 * piece, so moving onto the button to click it never hides it first.
 *
 * Routed with `getSmoothStepPath` (right-angle corners) rather than a bezier
 * curve — every trigger and target sits at the same rank-driven X per
 * `workflowGraph.ts`'s dagre layout, so edges fanning out of one trigger (or
 * into one target) share the same vertical run and read as a single routed
 * bus splitting into branches, not a tangle of independent curves.
 */
import { computed, ref } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@vue-flow/core'
import type { Position } from '@vue-flow/core'
import { XIcon } from '@lucide/vue'
import type { RoutingEdgeData } from '@/lib/workflowGraph'
import { useTriggerActionsStore } from '@/stores/triggerActions'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  markerEnd?: string
  data: RoutingEdgeData
  selected?: boolean
  hovered?: boolean
}>()

const store = useTriggerActionsStore()

const pathData = computed(() =>
  getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 6,
  }),
)
const path = computed(() => pathData.value[0])
const labelX = computed(() => pathData.value[1])
const labelY = computed(() => pathData.value[2])
const overlayHovered = ref(false)
const showOverlay = computed(() => props.hovered || props.selected || overlayHovered.value)

function remove(): void {
  // `id` is the edge's namespaced vue-flow id (`triggerActionEdgeId`, e.g.
  // "trigger-action:<uuid>") — the API wants the trigger_action row's own
  // raw id, carried unprefixed on `data.triggerAction.id`.
  void store.remove(props.data.triggerAction.id)
}
</script>

<template>
  <BaseEdge :id="id" :path="path" :marker-end="markerEnd" />
  <EdgeLabelRenderer>
    <div
      v-if="showOverlay"
      class="nodrag nopan pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
      :style="{ left: `${labelX}px`, top: `${labelY}px` }"
      @mouseenter="overlayHovered = true"
      @mouseleave="overlayHovered = false"
    >
      <span
        v-if="data.signalArgs.length"
        class="bg-popover text-popover-foreground whitespace-nowrap rounded-md border px-2 py-1 font-mono text-xs shadow-sm"
      >
        {{ data.signalArgs.join(', ') }}
      </span>
      <button
        type="button"
        class="bg-destructive text-destructive-foreground flex size-5 shrink-0 items-center justify-center rounded-full shadow-sm hover:opacity-90"
        aria-label="Delete wire"
        @click="remove"
      >
        <XIcon class="size-3" />
      </button>
    </div>
  </EdgeLabelRenderer>
</template>
