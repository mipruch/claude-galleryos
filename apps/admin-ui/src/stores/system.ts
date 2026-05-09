import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client';

export const useSystemStore = defineStore('system', () => {
  const uptime = ref(0);
  const runningScenes = ref(0);
  const drivers = ref<any[]>([]);

  async function fetchStatus() {
    try {
      const r = await api.get('/system/status');
      uptime.value = r.data.uptime;
      runningScenes.value = r.data.runningScenes;
      drivers.value = r.data.drivers ?? [];
    } catch {
      /* ignore */
    }
  }

  return { uptime, runningScenes, drivers, fetchStatus };
});
