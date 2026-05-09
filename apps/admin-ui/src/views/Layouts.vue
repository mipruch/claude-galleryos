<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api/client';
import { useScenesStore, useDevicesStore } from '../stores/data';

const scenes = useScenesStore();
const devices = useDevicesStore();
const list = ref<any[]>([]);
const editing = ref<any>(null);

async function load() {
  const r = await api.get('/layouts');
  list.value = r.data;
}
onMounted(async () => {
  await Promise.all([load(), scenes.fetchAll(), devices.fetchAll()]);
});

async function createNew() {
  const name = prompt('Jméno layoutu?');
  if (!name) return;
  const r = await api.post('/layouts', {
    name,
    config: { pages: [{ id: 'home', name: 'Hlavní', icon: 'home', widgets: [] }] },
  });
  list.value.push(r.data);
  editing.value = r.data;
}

function openLayout(l: any) {
  editing.value = JSON.parse(JSON.stringify(l));
}

async function save() {
  await api.put(`/layouts/${editing.value.id}`, {
    name: editing.value.name,
    config: editing.value.config,
  });
  await load();
}

async function setDefault() {
  await api.patch(`/layouts/${editing.value.id}/default`);
  await load();
}

function addPage() {
  editing.value.config.pages.push({
    id: `page-${editing.value.config.pages.length + 1}`,
    name: 'Nová stránka',
    icon: 'box',
    widgets: [],
  });
}

function addWidget(pageIdx: number, type: string) {
  const w: any = { type };
  if (type === 'scene_button') w.size = 'large';
  editing.value.config.pages[pageIdx].widgets.push(w);
}

function removeWidget(pageIdx: number, widgetIdx: number) {
  editing.value.config.pages[pageIdx].widgets.splice(widgetIdx, 1);
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">UI Layouty</h2>
      <button class="btn-primary" @click="createNew">+ Nový layout</button>
    </div>

    <div v-if="!editing" class="card">
      <table class="w-full text-sm">
        <thead class="text-left text-slate-400 border-b border-slate-700">
          <tr><th class="py-2">Jméno</th><th>Default</th><th>Stránky</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="l in list" :key="l.id" class="table-row">
            <td class="py-2 font-medium">{{ l.name }}</td>
            <td class="py-2">{{ l.is_default ? '✓' : '' }}</td>
            <td class="py-2">{{ l.config?.pages?.length ?? 0 }}</td>
            <td class="py-2 text-right">
              <button class="btn-secondary" @click="openLayout(l)">Editovat</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="space-y-4">
      <div class="flex items-center gap-2">
        <button class="btn-secondary" @click="editing = null">←</button>
        <input v-model="editing.name" class="input flex-1" />
        <button class="btn-secondary" @click="setDefault">Nastavit jako default</button>
        <button class="btn-primary" @click="save">Uložit</button>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="card space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">Stránky</h3>
            <button class="btn-secondary" @click="addPage">+ Stránka</button>
          </div>
          <div v-for="(p, pi) in editing.config.pages" :key="pi" class="bg-slate-900 rounded p-3 space-y-2">
            <input v-model="p.name" class="input" />
            <div class="flex flex-wrap gap-1 text-xs">
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'scene_button')">+ scene_button</button>
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'device_slider')">+ device_slider</button>
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'device_toggle')">+ device_toggle</button>
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'device_status')">+ device_status</button>
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'room_header')">+ room_header</button>
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'favorites_row')">+ favorites_row</button>
              <button class="btn-secondary text-xs" @click="addWidget(pi, 'spacer')">+ spacer</button>
            </div>
            <div class="space-y-1 mt-2">
              <div v-for="(w, wi) in p.widgets" :key="wi" class="bg-slate-800 p-2 rounded text-xs flex items-center gap-2">
                <span class="font-mono w-32">{{ w.type }}</span>
                <select
                  v-if="w.type === 'scene_button'"
                  v-model="w.scene_id"
                  class="input text-xs flex-1"
                >
                  <option v-for="s in scenes.list" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
                <select
                  v-else-if="['device_slider', 'device_toggle', 'device_status'].includes(w.type)"
                  v-model="w.device_id"
                  class="input text-xs flex-1"
                >
                  <option v-for="d in devices.list" :key="d.id" :value="d.id">{{ d.name }}</option>
                </select>
                <input
                  v-else-if="w.type === 'room_header'"
                  v-model="w.label"
                  placeholder="Nadpis"
                  class="input text-xs flex-1"
                />
                <span v-else class="flex-1 text-slate-500 text-xs italic">— bez parametrů —</span>
                <button class="btn-danger text-xs" @click="removeWidget(pi, wi)">×</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <h3 class="font-semibold mb-2">JSON config</h3>
          <pre class="text-xs font-mono whitespace-pre-wrap bg-slate-900 p-3 rounded">{{ JSON.stringify(editing.config, null, 2) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
