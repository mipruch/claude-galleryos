<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useSystemStore } from '../stores/system';
import { useScenesStore, useDevicesStore, useConnectionsStore } from '../stores/data';
import { socket } from '../socket';

const sys = useSystemStore();
const scenes = useScenesStore();
const devices = useDevicesStore();
const connections = useConnectionsStore();

const recentLogs = ref<any[]>([]);

async function loadLogs() {
  const r = await api.get('/logs', { params: { limit: 10 } });
  recentLogs.value = r.data;
}

onMounted(async () => {
  await Promise.all([
    sys.fetchStatus(),
    scenes.fetchAll(),
    devices.fetchAll(),
    connections.fetchAll(),
    loadLogs(),
  ]);
  socket.on('log:entry', (entry: any) => {
    recentLogs.value = [entry, ...recentLogs.value].slice(0, 10);
  });
});
</script>

<template>
  <div class="space-y-6">
    <h2 class="text-2xl font-bold">Dashboard</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="card">
        <p class="text-xs text-slate-400">Uptime</p>
        <p class="text-2xl font-mono">{{ sys.uptime }}s</p>
      </div>
      <div class="card">
        <p class="text-xs text-slate-400">Aktivní scény</p>
        <p class="text-2xl font-mono">{{ sys.runningScenes }}</p>
      </div>
      <div class="card">
        <p class="text-xs text-slate-400">Připojení</p>
        <p class="text-2xl font-mono">{{ connections.list.length }}</p>
      </div>
      <div class="card">
        <p class="text-xs text-slate-400">Zařízení</p>
        <p class="text-2xl font-mono">{{ devices.list.length }}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card">
        <h3 class="font-semibold mb-3">Oblíbené scény</h3>
        <div class="space-y-2">
          <div
            v-for="s in scenes.list.filter((s) => s.is_favorite)"
            :key="s.id"
            class="flex items-center justify-between p-2 bg-slate-900 rounded"
          >
            <span>{{ s.name }}</span>
            <button class="btn-primary" @click="scenes.execute(s.id)">Spustit</button>
          </div>
          <p v-if="scenes.list.filter((s) => s.is_favorite).length === 0" class="text-sm text-slate-500">
            Žádné oblíbené scény.
          </p>
        </div>
      </div>

      <div class="card">
        <h3 class="font-semibold mb-3">Připojení</h3>
        <div class="space-y-2">
          <div
            v-for="c in connections.list"
            :key="c.id"
            class="flex items-center justify-between p-2 bg-slate-900 rounded text-sm"
          >
            <span class="flex items-center gap-2">
              <span
                class="w-2 h-2 rounded-full"
                :class="connections.status[c.id]?.online ? 'bg-green-500' : 'bg-red-500'"
              ></span>
              {{ c.name }}
            </span>
            <span class="text-slate-500">{{ c.driver_id }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="font-semibold mb-3">Posledních 10 logů</h3>
      <div class="text-sm font-mono space-y-1 max-h-72 overflow-y-auto">
        <div
          v-for="(l, i) in recentLogs"
          :key="i"
          class="flex gap-3 py-1 border-b border-slate-700/30"
        >
          <span class="text-slate-500">{{ new Date(l.ts).toLocaleTimeString() }}</span>
          <span
            class="px-2 rounded text-xs"
            :class="{
              'bg-blue-900': l.level === 'info',
              'bg-yellow-900': l.level === 'warn',
              'bg-red-900': l.level === 'error',
              'bg-slate-700': l.level === 'debug',
            }"
            >{{ l.level }}</span
          >
          <span class="text-slate-400 w-32 truncate">{{ l.source }}</span>
          <span class="flex-1 truncate">{{ l.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
