<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { socket } from '../socket';

const logs = ref<any[]>([]);
const filterLevel = ref('');
const filterSource = ref('');

async function load() {
  const params: any = { limit: 200 };
  if (filterLevel.value) params.level = filterLevel.value;
  if (filterSource.value) params.source = filterSource.value;
  const r = await api.get('/logs', { params });
  logs.value = r.data;
}

onMounted(async () => {
  await load();
  socket.on('log:entry', (entry: any) => {
    if (filterLevel.value && entry.level !== filterLevel.value) return;
    if (filterSource.value && entry.source !== filterSource.value) return;
    logs.value = [entry, ...logs.value].slice(0, 500);
  });
});
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Logy</h2>
      <div class="flex gap-2">
        <select v-model="filterLevel" @change="load" class="input w-32">
          <option value="">— level —</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input v-model="filterSource" @change="load" placeholder="source" class="input w-40" />
        <button class="btn-secondary" @click="load">Refresh</button>
      </div>
    </div>

    <div class="card">
      <div class="text-xs font-mono space-y-1 max-h-[70vh] overflow-y-auto">
        <div v-for="(l, i) in logs" :key="i" class="flex gap-3 py-1 border-b border-slate-700/30">
          <span class="text-slate-500 w-24">{{ new Date(l.ts).toLocaleTimeString() }}</span>
          <span
            class="px-2 rounded text-xs w-16 text-center"
            :class="{
              'bg-blue-900': l.level === 'info',
              'bg-yellow-900': l.level === 'warn',
              'bg-red-900': l.level === 'error',
              'bg-slate-700': l.level === 'debug',
            }"
            >{{ l.level }}</span
          >
          <span class="text-slate-400 w-32 truncate">{{ l.source }}</span>
          <span class="flex-1">{{ l.message }}</span>
          <span v-if="Object.keys(l.metadata ?? {}).length" class="text-slate-500 text-xs truncate max-w-md">
            {{ JSON.stringify(l.metadata) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
