<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConnectionsStore, useDriversStore } from '../stores/data';

const connections = useConnectionsStore();
const drivers = useDriversStore();

const showDialog = ref(false);
const editing = ref<any>(null);
const form = ref<any>({ name: '', driver_id: '', host: '', port: null, config: {} });

const selectedManifest = computed(() =>
  drivers.list.find((m) => m.id === form.value.driver_id)
);
const schemaProperties = computed(
  () => (selectedManifest.value?.connectionSchema?.properties as any) ?? {}
);

onMounted(async () => {
  await Promise.all([connections.fetchAll(), drivers.fetchAll()]);
});

function openCreate() {
  editing.value = null;
  form.value = { name: '', driver_id: '', host: '', port: null, config: {} };
  showDialog.value = true;
}
function openEdit(c: any) {
  editing.value = c;
  form.value = { ...c, config: { ...(c.config ?? {}) } };
  showDialog.value = true;
}
async function save() {
  // Move host/port out of config if they're top-level
  const payload = {
    name: form.value.name,
    driver_id: form.value.driver_id,
    host: form.value.config.host ?? form.value.host,
    port: form.value.config.port ?? form.value.port,
    protocol: 'tcp',
    config: form.value.config,
    enabled: form.value.enabled ?? true,
  };
  if (editing.value) {
    await connections.update(editing.value.id, payload);
  } else {
    await connections.create(payload);
  }
  showDialog.value = false;
}
async function remove(c: any) {
  if (!confirm(`Smazat connection ${c.name}?`)) return;
  await connections.remove(c.id);
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Připojení</h2>
      <button class="btn-primary" @click="openCreate">+ Přidat</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-slate-400 border-b border-slate-700">
          <tr>
            <th class="py-2">Status</th>
            <th class="py-2">Jméno</th>
            <th class="py-2">Driver</th>
            <th class="py-2">Host</th>
            <th class="py-2">Port</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in connections.list" :key="c.id" class="table-row">
            <td class="py-2">
              <span
                class="inline-block w-2 h-2 rounded-full"
                :class="connections.status[c.id]?.online ? 'bg-green-500' : 'bg-red-500'"
              ></span>
            </td>
            <td class="py-2 font-medium">{{ c.name }}</td>
            <td class="py-2 font-mono text-slate-300">{{ c.driver_id }}</td>
            <td class="py-2 font-mono">{{ c.host ?? '—' }}</td>
            <td class="py-2 font-mono">{{ c.port ?? '—' }}</td>
            <td class="py-2 text-right space-x-2">
              <button class="btn-secondary" @click="openEdit(c)">Upravit</button>
              <button class="btn-danger" @click="remove(c)">Smazat</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="showDialog"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      @click.self="showDialog = false"
    >
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-lg">
        <h3 class="font-semibold mb-4">
          {{ editing ? 'Upravit connection' : 'Nová connection' }}
        </h3>
        <div class="space-y-3">
          <div>
            <label class="label">Jméno</label>
            <input v-model="form.name" class="input" />
          </div>
          <div>
            <label class="label">Driver</label>
            <select v-model="form.driver_id" class="input">
              <option value="">— vybrat driver —</option>
              <option v-for="d in drivers.list" :key="d.id" :value="d.id">
                {{ d.name }} ({{ d.id }})
              </option>
            </select>
          </div>
          <div v-for="(prop, key) in schemaProperties" :key="key">
            <label class="label">{{ (prop as any).title ?? key }}</label>
            <input
              v-if="(prop as any).type === 'integer' || (prop as any).type === 'number'"
              type="number"
              :placeholder="(prop as any).default ?? ''"
              v-model.number="form.config[key]"
              class="input"
            />
            <input
              v-else
              :placeholder="(prop as any).default ?? ''"
              v-model="form.config[key]"
              class="input"
            />
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
