<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useDriversStore } from '../stores/data';

const drivers = useDriversStore();
const status = ref<any>(null);

async function reload() {
  const r = await api.get('/system/status');
  status.value = r.data;
}
async function reloadDrivers() {
  await api.post('/system/reload-drivers');
  await reload();
}
onMounted(async () => {
  await Promise.all([drivers.fetchAll(), reload()]);
});
</script>

<template>
  <div class="space-y-4">
    <h2 class="text-2xl font-bold">Nastavení</h2>
    <div class="card">
      <h3 class="font-semibold mb-2">Stav serveru</h3>
      <pre class="text-xs font-mono whitespace-pre-wrap">{{ JSON.stringify(status, null, 2) }}</pre>
    </div>
    <div class="card space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">Drivery</h3>
        <button class="btn-secondary" @click="reloadDrivers">Reload</button>
      </div>
      <div v-for="d in drivers.list" :key="d.id" class="bg-slate-900 p-3 rounded text-sm">
        <div class="font-medium">{{ d.name }} <span class="text-slate-500 font-mono">{{ d.id }} v{{ d.version }}</span></div>
        <div class="text-xs text-slate-400">{{ d.vendor }} · subscriptions: {{ d.capabilities.subscriptions ? '✓' : '—' }} · discovery: {{ d.capabilities.discovery ? '✓' : '—' }}</div>
        <div class="text-xs text-slate-500 mt-1">Endpoints: {{ d.endpointTypes.map((t: any) => t.type).join(', ') }}</div>
      </div>
    </div>
  </div>
</template>
