<script setup lang="ts">
/**
 * Shared shell for every device control: a card with the device title, an
 * online/offline dot, and the device description shown as a tooltip on hover.
 * The actual control (fader, switch, …) is provided via the default slot.
 */
import { computed } from 'vue'
import { InfoIcon } from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDevicesStore } from '@/stores/devices'
import type { DeviceRecord } from '@/lib/devices'

const props = defineProps<{ device: DeviceRecord }>()

const store = useDevicesStore()
const online = computed(() => store.statusOf(props.device.id).online)
</script>

<template>
  <Card class="gap-4 py-4 h-full">
    <CardHeader class="px-4">
      <CardTitle class="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            class="flex min-w-0 items-center gap-1.5 text-left outline-none"
            :aria-label="device.description ?? device.name"
          >
            <span class="truncate">{{ device.name }}</span>
            <InfoIcon
              v-if="device.description"
              class="text-muted-foreground size-3.5 shrink-0"
            />
          </TooltipTrigger>
          <TooltipContent v-if="device.description">
            {{ device.description }}
          </TooltipContent>
        </Tooltip>

        <span class="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            class="size-2 rounded-full"
            :class="online ? 'bg-emerald-500' : 'bg-destructive'"
          />
          <span class="text-muted-foreground text-xs font-normal">
            {{ online ? 'Online' : 'Offline' }}
          </span>
        </span>
      </CardTitle>
    </CardHeader>

    <CardContent class="px-4">
      <slot />
    </CardContent>
  </Card>
</template>
