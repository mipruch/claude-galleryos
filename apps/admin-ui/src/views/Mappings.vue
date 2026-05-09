<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useScenesStore, useDevicesStore } from '../stores/data';

const list = ref<any[]>([]);
const scenes = useScenesStore();
const devices = useDevicesStore();
const showDialog = ref(false);
const form = ref<any>({
  name: '',
  protocol: 'osc',
  pattern: '/scene/:id/execute',
  target_type: 'scene.execute',
  target_id: null,
  target_command: null,
  params_template: {},
  enabled: true,
});

async function load() {
  const r = await api.get('/mappings');
  list.value = r.data;
}
onMounted(async () => {
  await Promise.all([load(), scenes.fetchAll(), devices.fetchAll()]);
});

async function save() {
  await api.post('/mappings', form.value);
  showDialog.value = false;
  await load();
}
async function remove(id: string) {
  if (!confirm('Smazat?')) return;
  await api.delete(`/mappings/${id}`);
  await load();
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Vstupní mapování</h2>
      <button class="btn-primary" @click="showDialog = true">+ Přidat</button>
    </div>
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-slate-400 border-b border-slate-700">
          <tr><th class="py-2">Jméno</th><th>Protokol</th><th>Pattern</th><th>Target</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id" class="table-row">
            <td class="py-2 font-medium">{{ m.name }}</td>
            <td class="py-2 uppercase text-xs">{{ m.protocol }}</td>
            <td class="py-2 font-mono text-xs">{{ m.pattern }}</td>
            <td class="py-2">{{ m.target_type }}</td>
            <td class="py-2 text-right">
              <button class="btn-danger" @click="remove(m.id)">Smazat</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="showDialog" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showDialog = false">
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
        <h3 class="font-semibold mb-4">Nové mapování</h3>
        <div class="space-y-3">
          <div><label class="label">Jméno</label><input v-model="form.name" class="input" /></div>
          <div>
            <label class="label">Protokol</label>
            <select v-model="form.protocol" class="input">
              <option value="osc">OSC</option><option value="tcp">TCP</option>
            </select>
          </div>
          <div><label class="label">Pattern</label><input v-model="form.pattern" class="input font-mono" /></div>
          <div>
            <label class="label">Target type</label>
            <select v-model="form.target_type" class="input">
              <option value="scene.execute">scene.execute</option>
              <option value="device.command">device.command</option>
            </select>
          </div>
          <div v-if="form.target_type === 'scene.execute'">
            <label class="label">Scéna</label>
            <select v-model="form.target_id" class="input">
              <option :value="null">—</option>
              <option v-for="s in scenes.list" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div v-else>
            <label class="label">Zařízení</label>
            <select v-model="form.target_id" class="input">
              <option :value="null">—</option>
              <option v-for="d in devices.list" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <label class="label mt-2">Command</label>
            <input v-model="form.target_command" class="input" />
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="btn-secondary" @click="showDialog = false">Zrušit</button>
          <button class="btn-primary" @click="save">Uložit</button>
        </div>
      </div>
    </div>
  </div>
</template>
