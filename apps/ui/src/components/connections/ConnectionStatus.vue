<script setup lang="ts">
/**
 * Backend-connection status indicator — sits next to the realtime (WiFi) badge.
 *
 * The trigger shows `connected/total` (e.g. "7/9") for enabled connections and
 * turns green only when every enabled connection is connected, red otherwise.
 * Clicking it opens a popover listing each connection with a colour-coded state
 * (green connected · yellow reconnecting · red disconnected · grey disabled),
 * its name, type and any error, plus a switch to enable/disable it.
 */
import { onMounted } from 'vue'
import { ServerIcon, CircleAlertIcon, ChevronDownIcon } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useConnectionsStore } from '@/stores/connections'
import { STATE_COLOR, STATE_DOT, STATE_LABEL } from '@/lib/connections'

const store = useConnectionsStore()

onMounted(() => store.init())
</script>

<template>
  <Popover>
    <PopoverTrigger
      class="hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 hover:cursor-pointer"
      :class="store.allConnected ? 'text-emerald-600 dark:text-emerald-500' : 'text-destructive'"
      :aria-label="`Connections: ${store.label} connected`"
    >
      <ServerIcon class="size-4" />
      <span class="tabular-nums">{{ store.label }}</span>
      <ChevronDownIcon class="size-3 opacity-60" />
    </PopoverTrigger>

    <PopoverContent align="end" class="w-96 p-0">
      <div class="border-b px-4 py-3">
        <h2 class="text-sm font-semibold">Connections</h2>
        <p class="text-muted-foreground text-xs">
          {{ store.connectedCount }} of {{ store.enabledCount }} enabled connected
        </p>
      </div>

      <ul v-if="store.connections.length" class="max-h-80 divide-y overflow-y-auto">
        <li
          v-for="c in store.connections"
          :key="c.id"
          class="flex items-start gap-3 px-4 py-3"
        >
          <span
            class="mt-1.5 size-2 shrink-0 rounded-full"
            :class="STATE_DOT[c.state]"
            :title="STATE_LABEL[c.state]"
          />

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{{ c.name }}</span>
              <span class="text-muted-foreground shrink-0 text-xs">{{ c.driverId }}</span>
            </div>
            <div class="text-xs" :class="STATE_COLOR[c.state]">{{ STATE_LABEL[c.state] }}</div>
            <div
              v-if="c.state !== 'disabled' && c.status.lastError"
              class="text-destructive mt-0.5 flex items-start gap-1 text-xs"
            >
              <CircleAlertIcon class="mt-0.5 size-3 shrink-0" />
              <span class="break-words">{{ c.status.lastError }}</span>
            </div>
          </div>

          <Switch
            :model-value="c.enabled"
            class="mt-0.5 shrink-0"
            :aria-label="`Enable ${c.name}`"
            @update:model-value="(v) => store.setEnabled(c.id, v)"
          />
        </li>
      </ul>

      <p v-else class="text-muted-foreground px-4 py-6 text-center text-sm">
        No connections configured.
      </p>
    </PopoverContent>
  </Popover>
</template>
