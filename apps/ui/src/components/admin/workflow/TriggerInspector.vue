<script setup lang="ts">
/**
 * Right-sidebar dispatcher for a selected trigger node (a mapping or a
 * schedule) — the canvas replacement for the old MappingFormDialog /
 * ScheduleFormDialog modals. Just picks which of the two very differently-
 * shaped forms to render: `MappingTriggerForm` (a plain name/protocol/
 * pattern/enabled form) or `CronScheduleForm` (the redesigned Repeats
 * picker). Wiring what a trigger fires is a canvas connection instead,
 * opening `WorkflowTargetInspector` on the target end when selected.
 *
 * The parent view keys this component on the selected node's id
 * (`:key="…"` in WorkflowsView), so a fresh instance mounts per selection.
 * `remove()` is forwarded from whichever child form is actually mounted, so
 * the parent's Delete-key shortcut and its own trash button keep working
 * without knowing which trigger kind is currently selected.
 */
import { computed, ref } from 'vue'
import type { RoutingNodeData } from '@/lib/workflowGraph'
import MappingTriggerForm from './MappingTriggerForm.vue'
import CronScheduleForm from './CronScheduleForm.vue'

const props = defineProps<{ data: Extract<RoutingNodeData, { kind: 'mapping' | 'schedule' }> }>()
const emit = defineEmits<{ remove: []; close: [] }>()

const isMapping = computed(() => props.data.kind === 'mapping')

const mappingFormRef = ref<InstanceType<typeof MappingTriggerForm> | null>(null)
const cronFormRef = ref<InstanceType<typeof CronScheduleForm> | null>(null)

async function remove(): Promise<void> {
  if (isMapping.value) await mappingFormRef.value?.remove()
  else await cronFormRef.value?.remove()
}

defineExpose({ remove })
</script>

<template>
  <MappingTriggerForm
    v-if="data.kind === 'mapping'"
    ref="mappingFormRef"
    :mapping="data.mapping"
    @remove="emit('remove')"
    @close="emit('close')"
  />
  <CronScheduleForm
    v-else
    ref="cronFormRef"
    :schedule="data.schedule"
    @remove="emit('remove')"
    @close="emit('close')"
  />
</template>
