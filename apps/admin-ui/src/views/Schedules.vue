<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useScenesStore } from '../stores/data';

const scenes = useScenesStore();
const list = ref<any[]>([]);
const showDialog = ref(false);
const form = ref<any>({ name: '', scene_id: '', cron: '0 8 * * 1-5', timezone: 'Europe/Prague', enabled: true });

async function load() {
  const r = await api.get('/schedules');
  list.value = r.data;
}
onMounted(async () => {
  await Promise.all([load(), scenes.fetchAll()]);
});

async function save() {
  await api.post('/schedules', form.value);
  showDialog.value = false;
  form.value = { name: '', scene_id: '', cron: '0 8 * * 1-5', timezone: 'Europe/Prague', enabled: true };
  await load();
}
async function toggle(id: string) {
  await api.patch(`/schedules/${id}/toggle`);
  await load();
}
async function remove(id: string) {
  if (!confirm('Smazat?')) return;
  await api.delete(`/schedules/${id}`);
  await load();
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Plánované úlohy</h2>
      <button class="btn-primary" @click="showDialog = true">+ Přidat</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-slate-400 border-b border-slate-700">
          <tr><th class="py-2">Jméno</th><th>CRON</th><th>Scéna</th><th>TZ</th><th>Stav</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="j in list" :key="j.id" class="table-row">
            <td class="py-2 font-medium">{{ j.name }}</td>
            <td class="py-2 font-mono text-xs">{{ j.cron }}</td>
            <td class="py-2">{{ scenes.list.find((s) => s.id === j.scene_id)?.name ?? j.scene_id }}</td>
            <td class="py-2">{{ j.timezone }}</td>
            <td class="py-2">
              <button @click="toggle(j.id)" class="text-xs px-2 py-1 rounded" :class="j.enabled ? 'bg-green-700' : 'bg-slate-700'">
                {{ j.enabled ? 'aktivní' : 'vypnutý' }}
              </button>
            </td>
            <td class="py-2 text-right">
              <button class="btn-danger" @click="remove(j.id)">Smazat</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showDialog" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showDialog = false">
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
        <h3 class="font-semibold mb-4">Nová plánovaná úloha</h3>
        <div class="space-y-3">
          <div><label class="label">Jméno</label><input v-model="form.name" class="input" /></div>
          <div>
            <label class="label">Scéna</label>
            <select v-model="form.scene_id" class="input">
              <option value="">—</option>
              <option v-for="s in scenes.list" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div><label class="label">CRON</label><input v-model="form.cron" class="input font-mono" /></div>
          <div><label class="label">Timezone</label><input v-model="form.timezone" class="input" /></div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="btn-secondary" @click="showDialog = false">Zrušit</button>
          <button class="btn-primary" @click="save">Uložit</button>
        </div>
      </div>
    </div>
  </div>
</template>
