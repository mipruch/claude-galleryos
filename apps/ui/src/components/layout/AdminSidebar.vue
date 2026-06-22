<script setup lang="ts">
/**
 * Admin portal navigation. Built sections are router links; sections planned for
 * later passes render disabled with a "soon" tag so the full information
 * architecture is visible. A link back to the user panel sits at the bottom.
 */
import type { Component } from 'vue'
import {
  ArrowLeftIcon,
  CableIcon,
  CalendarClockIcon,
  LayoutDashboardIcon,
  LayoutTemplateIcon,
  MonitorSpeakerIcon,
  ScrollTextIcon,
  SettingsIcon,
  SparklesIcon,
  WaypointsIcon,
} from '@lucide/vue'

interface NavItem {
  to: string
  label: string
  icon: Component
  enabled: boolean
}

const items: NavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboardIcon, enabled: true },
  { to: '/admin/connections', label: 'Connections', icon: CableIcon, enabled: true },
  { to: '/admin/devices', label: 'Devices', icon: MonitorSpeakerIcon, enabled: true },
  { to: '/admin/scenes', label: 'Scenes', icon: SparklesIcon, enabled: true },
  { to: '/admin/schedules', label: 'Schedules', icon: CalendarClockIcon, enabled: true },
  { to: '/admin/mappings', label: 'Mappings', icon: WaypointsIcon, enabled: false },
  { to: '/admin/layouts', label: 'Layouts', icon: LayoutTemplateIcon, enabled: false },
  { to: '/admin/logs', label: 'Logs', icon: ScrollTextIcon, enabled: true },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon, enabled: true },
]

function linkClass(isActive: boolean): string {
  return [
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors outline-none',
    'focus-visible:ring-ring focus-visible:ring-2',
    isActive
      ? 'bg-accent text-foreground font-medium'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  ].join(' ')
}
</script>

<template>
  <aside class="bg-background flex w-56 shrink-0 flex-col border-r">
    <div class="border-b px-4 py-4">
      <h1 class="text-lg font-semibold tracking-tight">GalleryOS</h1>
      <p class="text-muted-foreground text-xs">Admin</p>
    </div>

    <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
      <template v-for="item in items" :key="item.to">
        <RouterLink
          v-if="item.enabled"
          :to="item.to"
          custom
          v-slot="{ href, navigate, isActive }"
        >
          <a :href="href" :class="linkClass(isActive)" @click="navigate">
            <component :is="item.icon" class="size-4 shrink-0" />
            <span class="flex-1 truncate">{{ item.label }}</span>
          </a>
        </RouterLink>
        <span
          v-else
          class="text-muted-foreground/50 flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-sm"
          :title="`${item.label} — coming soon`"
        >
          <component :is="item.icon" class="size-4 shrink-0" />
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span class="bg-muted rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase">soon</span>
        </span>
      </template>
    </nav>

    <div class="border-t p-2">
      <RouterLink to="/" custom v-slot="{ href, navigate }">
        <a :href="href" :class="linkClass(false)" @click="navigate">
          <ArrowLeftIcon class="size-4 shrink-0" />
          <span class="flex-1 truncate">User panel</span>
        </a>
      </RouterLink>
    </div>
  </aside>
</template>
