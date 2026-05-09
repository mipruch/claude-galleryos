<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  useDevicesStore,
  useConnectionsStore,
  useDriversStore,
  useRoomsStore,
} from '../stores/data';
import { socket } from '../socket';

const devices = useDevicesStore();
const connections = useConnectionsStore();
const drivers = useDriversStore();
const rooms = useRoomsStore();

const showDialog = ref(false);
const showCmd = ref(false);
const cmdTarget = ref<any>(null);
const cmdName = ref('');
const cmdParams = ref<any>({});
const editing = ref<any>(null);

const form = ref<any>({
  name: '',
  connection_id: '',
  room_id: null,
  type: 'lighting',
  subtype: '',
  address: {},
  capabilities: [],
});

const selectedConnection = computed(() =>
  connections.list.find((c) => c.id === form.value.connection_id)
);
const selectedManifest = computed(() => {
  if (!selectedConnection.value) return null;
  return drivers.list.find((d) => d.id === selectedConnection.value.driver_id);
});
const endpointTypes = computed(() => selectedManifest.value?.endpointTypes ?? []);
const selectedEndpointType = computed(() =>
  endpointTypes.value.find((t: any) => t.type === form.value.subtype)
);
const addressProperties = computed(
  () => selectedEndpointType.value?.addressSchema?.properties ?? {}
);

onMounted(async () => {
  await Promise.all([
    devices.fetchAll(),
    connections.fetchAll(),
    drivers.fetchAll(),
    rooms.fetchAll(),
  ]);
  socket.on('device:state', (data: any) => {
    devices.states[data.deviceId] = data.state;
  });
  socket.on('device:online', (data: any) => (devices.onlineMap[data.deviceId] = true));
  socket.on('device:offline', (data: any) => (devices.onlineMap[data.deviceId] = false));
});

function openCreate() {
  editing.value = null;
  form.value = {
    name: '',
    connection_id: '',
    room_id: null,
    type: 'lighting',
    subtype: '',
    address: {},
    capabilities: [],
  };
  showDialog.value = true;
}
function openEdit(d: any) {
  editing.value = d;
  form.value = { ...d, address: { ...(d.address ?? {}) } };
  showDialog.value = true;
}
async function save() {
  if (!form.value.subtype && endpointTypes.value.length > 0) {
    form.value.subtype = endpointTypes.value[0].type;
  }
  // Auto-fill capabilities from manifest if empty
  if ((!form.value.capabilities || form.value.capabilities.length === 0) && selectedEndpointType.value) {
    form.value.capabilities = selectedEndpointType.value.commands.map((c: any) => c.command);
  }
  const payload = { ...form.value };
  if (editing.value) await devices.update(editing.value.id, payload);
  else await devices.create(payload);
  showDialog.value = false;
}
async function remove(d: any) {
  if (!confirm(`Smazat zařízení ${d.name}?`)) return;
  await devices.remove(d.id);
}

function openCommand(d: any) {
  cmdTarget.value = d;
  cmdName.value = d.capabilities?.[0] ?? 'on';
  cmdParams.value = {};
  showCmd.value = true;
}
async function runCommand() {
  await devices.command(cmdTarget.value.id, cmdName.value, cmdParams.value);
  showCmd.value = false;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-bold">Zařízení</h2>
      <button class="btn-primary" @click="openCreate">+ Přidat</button>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-slate-400 border-b border-slate-700">
          <tr>
            <th class="py-2">Status</th>
            <th class="py-2">Jméno</th>
            <th class="py-2">Typ</th>
            <th class="py-2">Connection</th>
            <th class="py-2">Místnost</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in devices.list" :key="d.id" class="table-row">
            <td>
              <span
                class="inline-block w-2 h-2 rounded-full"
                :class="devices.onlineMap[d.id] === false ? 'bg-red-500' : 'bg-green-500'"
              ></span>
            </td>
            <td class="py-2 font-medium">{{ d.name }}</td>
            <td class="py-2">{{ d.type }} <span class="text-slate-500 text-xs">/ {{ d.subtype }}</span></td>
            <td class="py-2 font-mono text-xs">
              {{ connections.list.find((c) => c.id === d.connection_id)?.name ?? '—' }}
            </td>
            <td class="py-2">
              {{ rooms.list.find((r) => r.id === d.room_id)?.name ?? '—' }}
            </td>
            <td class="py-2 text-right space-x-2">
              <button class="btn-secondary" @click="openCommand(d)">Příkaz</button>
              <button class="btn-secondary" @click="openEdit(d)">Upravit</button>
              <button class="btn-danger" @click="remove(d)">Smazat</button>
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
        <h3 class="font-semibold mb-4">{{ editing ? 'Upravit' : 'Nové' }} zařízení</h3>
        <div class="space-y-3 max-h-[60vh] overflow-y-auto">
          <div>
            <label class="label">Jméno</label>
            <input v-model="form.name" class="input" />
          </div>
          <div>
            <label class="label">Connection</label>
            <select v-model="form.connection_id" class="input">
              <option value="">—</option>
              <option v-for="c in connections.list" :key="c.id" :value="c.id">
                {{ c.name }} ({{ c.driver_id }})
              </option>
            </select>
          </div>
          <div>
            <label class="label">Místnost</label>
            <select v-model="form.room_id" class="input">
              <option :value="null">— bez místnosti —</option>
              <option v-for="r in rooms.list" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
          <div>
            <label class="label">Typ zařízení</label>
            <select v-model="form.type" class="input">
              <option v-for="t in ['lighting','audio','microphone','video','display','matrix','blind','power','custom']" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div v-if="endpointTypes.length > 0">
            <label class="label">Endpoint type</label>
            <select v-model="form.subtype" class="input">
              <option v-for="t in endpointTypes" :key="(t as any).type" :value="(t as any).type">
                {{ (t as any).name }} — {{ (t as any).type }}
              </option>
            </select>
          </div>
          <div v-for="(prop, key) in addressProperties" :key="key">
            <label class="label">{{ (prop as any).title ?? key }}</label>
            <input
              v-if="(prop as any).type === 'integer' || (prop as any).type === 'number'"
              type="number"
              v-model.number="form.address[key]"
              class="input"
            />
            <input v-else v-model="form.address[key]" class="input" />
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="btn-secondary" @click="showDialog = false">Zrušit</button>
          <button class="btn-primary" @click="save">Uložit</button>
        </div>
      </div>
    </div>

    <div
      v-if="showCmd"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      @click.self="showCmd = false"
    >
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-6 w-full max-w-md">
        <h3 class="font-semibold mb-4">Příkaz: {{ cmdTarget?.name }}</h3>
        <div class="space-y-3">
          <div>
            <label class="label">Příkaz</label>
            <select v-model="cmdName" class="input">
              <option v-for="c in cmdTarget?.capabilities ?? []" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div>
            <label class="label">Parametry (JSON)</label>
            <textarea
              class="input font-mono"
              rows="4"
              :value="JSON.stringify(cmdParams, null, 2)"
              @input="cmdParams = JSON.parse(($event.target as HTMLTextAreaElement).value || '{}')"
            ></textarea>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="btn-secondary" @click="showCmd = false">Zrušit</button>
          <button class="btn-primary" @click="runCommand">Spustit</button>
        </div>
      </div>
    </div>
  </div>
</template>
