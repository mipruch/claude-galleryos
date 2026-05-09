<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useScenesStore, useRoomsStore } from '../stores/data';
import { socket } from '../socket';

const scenes = useScenesStore();
const rooms = useRoomsStore();

const showDialog = ref(false);
const newName = ref('');
const newRoomId = ref<string | null>(null);
const status = ref<Record<string, string>>({});

onMounted(async () => {
  await Promise.all([scenes.fetchAll(), rooms.fetchAll()]);
  socket.on('scene:started', (d: any) => (status.value[d.sceneId] = 'running'));
  socket.on('scene:completed', (d: any) => {
    status.value[d.sceneId] = 'done';
    setTimeout(() => delete status.value[d.sceneId], 3000);
  });
  socket.on('scene:failed', (d: any) => {
    status.value[d.sceneId] = 'failed';
  });
});

async function create() {
  await scenes.create({ name: newName.value, room_id: newRoomId.value });
  showDialog.value = false;
  newName.value = '';
  newRoomId.value = null;
}

async function execute(s: any) {
  await scenes.execute(s.id);
}

async function toggleFav(s: any) {
  await scenes.update(s.id, { is_favorite: !s.is_favorite });
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Scény</h2>
      <button class="btn-primary" @click="showDialog = true">+ Nová scéna</button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="s in scenes.list"
        :key="s.id"
        class="card flex flex-col gap-2"
        :style="s.color ? `border-left: 4px solid ${s.color}` : ''"
      >
        <div class="flex items-center justify-between">
          <h3 class="font-semibold">{{ s.name }}</h3>
          <button @click="toggleFav(s)" class="text-yellow-400 text-lg">
            {{ s.is_favorite ? '★' : '☆' }}
          </button>
        </div>
        <p class="text-sm text-slate-400">{{ s.description ?? '—' }}</p>
        <p class="text-xs text-slate-500">
          {{ rooms.list.find((r) => r.id === s.room_id)?.name ?? 'Globální' }} · v{{ s.version }}
        </p>
        <p
          v-if="status[s.id]"
          class="text-xs"
          :class="{
            'text-blue-400': status[s.id] === 'running',
            'text-green-400': status[s.id] === 'done',
            'text-red-400': status[s.id] === 'failed',
          }"
        >
          {{ status[s.id] }}
        </p>
        <div class="flex gap-2 mt-auto">
          <button class="btn-primary flex-1" @click="execute(s)">Spustit</button>
          <RouterLink :to="`/scenes/${s.id}`" class="btn-secondary">Editor</RouterLink>
        </div>
      </div>
      <p v-if="scenes.list.length === 0" class="text-slate-500 col-span-full">Žádné scény.</p>
    </div>

    <div
      v-if="showDialog"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      @click.self="showDialog = false"
    >
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
        <h3 class="font-semibold mb-4">Nová scéna</h3>
        <div class="space-y-3">
          <div>
            <label class="label">Jméno</label>
            <input v-model="newName" class="input" />
          </div>
          <div>
            <label class="label">Místnost</label>
            <select v-model="newRoomId" class="input">
              <option :value="null">— globální —</option>
              <option v-for="r in rooms.list" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="btn-secondary" @click="showDialog = false">Zrušit</button>
          <button class="btn-primary" @click="create">Vytvořit</button>
        </div>
      </div>
    </div>
  </div>
</template>
