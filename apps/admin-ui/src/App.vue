<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { connectSocket, socket } from './socket';
import { useSystemStore } from './stores/system';

const sys = useSystemStore();
const wsConnected = ref(false);

onMounted(() => {
  connectSocket();
  socket.on('connect', () => (wsConnected.value = true));
  socket.on('disconnect', () => (wsConnected.value = false));
  void sys.fetchStatus();
  setInterval(() => sys.fetchStatus(), 10000);
});

const navItems = [
  { to: '/', label: 'Dashboard', icon: '◉' },
  { to: '/connections', label: 'Připojení', icon: '⇄' },
  { to: '/devices', label: 'Zařízení', icon: '⚙' },
  { to: '/scenes', label: 'Scény', icon: '★' },
  { to: '/schedules', label: 'Plán', icon: '◷' },
  { to: '/mappings', label: 'Vstupy', icon: '⇒' },
  { to: '/layouts', label: 'Layouty', icon: '▦' },
  { to: '/logs', label: 'Logy', icon: '☰' },
];
</script>

<template>
  <div class="flex h-full">
    <aside class="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
      <div class="p-4 border-b border-slate-800">
        <h1 class="font-bold text-blue-400">GalleryOS</h1>
        <p class="text-xs text-slate-500">Admin</p>
      </div>
      <nav class="flex-1 p-2 space-y-1">
        <RouterLink
          v-for="i in navItems"
          :key="i.to"
          :to="i.to"
          class="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-slate-800 transition-colors"
          active-class="bg-slate-800 text-blue-400"
        >
          <span class="w-5 text-center">{{ i.icon }}</span>
          <span>{{ i.label }}</span>
        </RouterLink>
      </nav>
      <div class="p-3 border-t border-slate-800 text-xs">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full" :class="wsConnected ? 'bg-green-500' : 'bg-red-500'"></span>
          <span class="text-slate-400">{{ wsConnected ? 'WS online' : 'WS offline' }}</span>
        </div>
        <div class="text-slate-500 mt-1">uptime: {{ sys.uptime }}s</div>
      </div>
    </aside>
    <main class="flex-1 overflow-y-auto p-6">
      <RouterView />
    </main>
  </div>
</template>
