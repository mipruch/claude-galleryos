<script setup lang="ts">
/**
 * Generic momentary-trigger control — a row of buttons, each firing one
 * predefined, fire-and-forget command with no state to track (unlike
 * `select`, there's no "current" button). The button list is per-device data;
 * see `lib/widgets.ts#buttonsFor`. Built for driver-generic-trigger's TCP/UDP/
 * OSC "just send a message" endpoints, but works for any driver whose
 * `buttons` widget command needs no optimistic state.
 */
import { computed, reactive } from 'vue'
import { Button } from '@/components/ui/button'
import type { ButtonsWidgetBinding } from '@gallery/driver-core'
import { buttonsFor } from '@/lib/widgets'
import type { DeviceRecord } from '@/lib/devices'
import { useDevicesStore } from '@/stores/devices'

const props = defineProps<{ device: DeviceRecord; binding: ButtonsWidgetBinding }>()
const store = useDevicesStore()

// Reactive (like SelectWidget's options) so an admin edit to the button list
// re-renders this widget instead of requiring a remount.
const buttons = computed(() => buttonsFor(props.device))
// Per-button in-flight flag, keyed by index — disables just the clicked
// button (not the whole row) so firing two different cues back to back stays
// snappy, while a double-click on the *same* button can't double-fire it.
const pending = reactive<Record<number, boolean>>({})

async function fire(index: number): Promise<void> {
  if (pending[index]) return
  pending[index] = true
  try {
    await store.sendCommand(props.device.id, props.binding.command, buttons.value[index]!.params)
  } finally {
    pending[index] = false
  }
}
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <Button
      v-for="(button, index) in buttons"
      :key="index"
      type="button"
      variant="outline"
      size="sm"
      :disabled="pending[index]"
      @click="fire(index)"
    >
      {{ button.label }}
    </Button>
  </div>
</template>
