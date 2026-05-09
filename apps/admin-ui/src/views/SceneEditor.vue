<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client';
import { useDevicesStore, useDriversStore, useConnectionsStore } from '../stores/data';

const route = useRoute();
const router = useRouter();
const devices = useDevicesStore();
const drivers = useDriversStore();
const connections = useConnectionsStore();

const scene = ref<any>(null);
const dryRunOutput = ref<string>('');

const sceneId = computed(() => route.params.id as string);

async function load() {
  const r = await api.get(`/scenes/${sceneId.value}`);
  scene.value = r.data;
  if (!Array.isArray(scene.value.actions)) scene.value.actions = [];
  if (!Array.isArray(scene.value.tags)) scene.value.tags = [];
}

onMounted(async () => {
  await Promise.all([
    devices.fetchAll(),
    drivers.fetchAll(),
    connections.fetchAll(),
    load(),
  ]);
});

function commandsFor(deviceId: string): string[] {
  const dev = devices.list.find((d) => d.id === deviceId);
  return dev?.capabilities ?? [];
}

function addAction() {
  scene.value.actions.push({
    device_id: devices.list[0]?.id ?? '',
    step_order: scene.value.actions.length,
    parallel_group: 0,
    delay_ms: 0,
    command: 'on',
    params: {},
    on_failure: 'continue',
  });
}

function removeAction(idx: number) {
  scene.value.actions.splice(idx, 1);
}

async function save() {
  await api.put(`/scenes/${sceneId.value}`, {
    name: scene.value.name,
    description: scene.value.description,
    icon: scene.value.icon,
    color: scene.value.color,
    is_favorite: scene.value.is_favorite,
    tags: scene.value.tags,
    room_id: scene.value.room_id,
    actions: scene.value.actions,
  });
  await load();
}

async function execute() {
  await api.post(`/scenes/${sceneId.value}/execute`, { source: 'admin' });
}

async function dryRun() {
  const r = await api.post(`/scenes/${sceneId.value}/execute/dry-run`);
  dryRunOutput.value = JSON.stringify(r.data, null, 2);
}

async function remove() {
  if (!confirm('Smazat scénu?')) return;
  await api.delete(`/scenes/${sceneId.value}`);
  router.push('/scenes');
}
</script>

<template>
  <div v-if="scene" class="space-y-4">
    <div class="flex items-center gap-4">
      <RouterLink to="/scenes" class="btn-secondary">←</RouterLink>
      <h2 class="text-2xl font-bold flex-1">Editor scény</h2>
      <button class="btn-secondary" @click="dryRun">Dry run</button>
      <button class="btn-primary" @click="execute">Spustit</button>
      <button class="btn-secondary" @click="save">Uložit</button>
      <button class="btn-danger" @click="remove">Smazat</button>
    </div>

    <div class="card grid grid-cols-2 gap-3">
      <div>
        <label class="label">Jméno</label>
        <input v-model="scene.name" class="input" />
      </div>
      <div>
        <label class="label">Barva</label>
        <input v-model="scene.color" type="color" class="input h-10" />
      </div>
      <div class="col-span-2">
        <label class="label">Popis</label>
        <input v-model="scene.description" class="input" />
      </div>
    </div>

    <div class="card">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">Akce ({{ scene.actions.length }})</h3>
        <button class="btn-primary" @click="addAction">+ Přidat akci</button>
      </div>
      <div class="space-y-2">
        <div
          v-for="(a, idx) in scene.actions"
          :key="idx"
          class="bg-slate-900 p-3 rounded grid grid-cols-12 gap-2 items-center text-sm"
        >
          <div class="col-span-1">
            <label class="text-xs text-slate-500">Group</label>
            <input type="number" v-model.number="a.parallel_group" class="input" />
          </div>
          <div class="col-span-3">
            <label class="text-xs text-slate-500">Zařízení</label>
            <select v-model="a.device_id" class="input">
              <option v-for="d in devices.list" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
          <div class="col-span-2">
            <label class="text-xs text-slate-500">Příkaz</label>
            <select v-model="a.command" class="input">
              <option v-for="c in commandsFor(a.device_id)" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="col-span-3">
            <label class="text-xs text-slate-500">Params (JSON)</label>
            <input
              :value="JSON.stringify(a.params)"
              @change="a.params = JSON.parse(($event.target as HTMLInputElement).value || '{}')"
              class="input font-mono"
            />
          </div>
          <div class="col-span-1">
            <label class="text-xs text-slate-500">Delay</label>
            <input type="number" v-model.number="a.delay_ms" class="input" />
          </div>
          <div class="col-span-1">
            <label class="text-xs text-slate-500">On fail</label>
            <select v-model="a.on_failure" class="input">
              <option value="continue">cont</option>
              <option value="abort">abort</option>
              <option value="rollback">roll</option>
            </select>
          </div>
          <div class="col-span-1 text-right">
            <button class="btn-danger text-xs" @click="removeAction(idx)">×</button>
          </div>
        </div>
        <p v-if="scene.actions.length === 0" class="text-slate-500 text-sm">
          Žádné akce — přidejte první přes „+ Přidat akci".
        </p>
      </div>
    </div>

    <div v-if="dryRunOutput" class="card">
      <h3 class="font-semibold mb-2">Dry run výsledek</h3>
      <pre class="text-xs font-mono whitespace-pre-wrap">{{ dryRunOutput }}</pre>
    </div>
  </div>
</template>
