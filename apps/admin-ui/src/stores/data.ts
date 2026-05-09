import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api/client';

interface Manifest {
  id: string;
  name: string;
  vendor: string;
  version: string;
  connectionSchema: any;
  endpointTypes: any[];
  capabilities: { discovery: boolean; subscriptions: boolean; bidirectional: boolean };
}

export const useDriversStore = defineStore('drivers', () => {
  const list = ref<Manifest[]>([]);
  async function fetchAll() {
    const r = await api.get<Manifest[]>('/drivers');
    list.value = r.data;
  }
  return { list, fetchAll };
});

export const useRoomsStore = defineStore('rooms', () => {
  const list = ref<any[]>([]);
  async function fetchAll() {
    const r = await api.get('/rooms');
    list.value = r.data;
  }
  async function create(payload: any) {
    const r = await api.post('/rooms', payload);
    list.value.push(r.data);
    return r.data;
  }
  async function update(id: string, payload: any) {
    const r = await api.put(`/rooms/${id}`, payload);
    const idx = list.value.findIndex((x) => x.id === id);
    if (idx >= 0) list.value[idx] = r.data;
    return r.data;
  }
  async function remove(id: string) {
    await api.delete(`/rooms/${id}`);
    list.value = list.value.filter((x) => x.id !== id);
  }
  return { list, fetchAll, create, update, remove };
});

export const useConnectionsStore = defineStore('connections', () => {
  const list = ref<any[]>([]);
  const status = ref<Record<string, any>>({});
  async function fetchAll() {
    const r = await api.get('/connections');
    list.value = r.data;
    await Promise.all(
      r.data.map(async (c: any) => {
        try {
          const s = await api.get(`/connections/${c.id}/status`);
          status.value[c.id] = s.data;
        } catch {
          /* ignore */
        }
      })
    );
  }
  async function create(payload: any) {
    const r = await api.post('/connections', payload);
    await fetchAll();
    return r.data;
  }
  async function update(id: string, payload: any) {
    const r = await api.put(`/connections/${id}`, payload);
    await fetchAll();
    return r.data;
  }
  async function remove(id: string) {
    await api.delete(`/connections/${id}`);
    list.value = list.value.filter((x) => x.id !== id);
  }
  return { list, status, fetchAll, create, update, remove };
});

export const useDevicesStore = defineStore('devices', () => {
  const list = ref<any[]>([]);
  const states = ref<Record<string, any>>({});
  const onlineMap = ref<Record<string, boolean>>({});
  async function fetchAll() {
    const r = await api.get('/devices');
    list.value = r.data;
  }
  async function create(payload: any) {
    const r = await api.post('/devices', payload);
    list.value.push(r.data);
    return r.data;
  }
  async function update(id: string, payload: any) {
    const r = await api.put(`/devices/${id}`, payload);
    const idx = list.value.findIndex((x) => x.id === id);
    if (idx >= 0) list.value[idx] = r.data;
    return r.data;
  }
  async function remove(id: string) {
    await api.delete(`/devices/${id}`);
    list.value = list.value.filter((x) => x.id !== id);
  }
  async function command(id: string, command: string, params: any) {
    const r = await api.post(`/devices/${id}/command`, { command, params });
    return r.data;
  }
  return { list, states, onlineMap, fetchAll, create, update, remove, command };
});

export const useScenesStore = defineStore('scenes', () => {
  const list = ref<any[]>([]);
  async function fetchAll() {
    const r = await api.get('/scenes');
    list.value = r.data;
  }
  async function get(id: string) {
    const r = await api.get(`/scenes/${id}`);
    return r.data;
  }
  async function create(payload: any) {
    const r = await api.post('/scenes', payload);
    list.value.push(r.data);
    return r.data;
  }
  async function update(id: string, payload: any) {
    const r = await api.put(`/scenes/${id}`, payload);
    const idx = list.value.findIndex((x) => x.id === id);
    if (idx >= 0) list.value[idx] = r.data;
    return r.data;
  }
  async function remove(id: string) {
    await api.delete(`/scenes/${id}`);
    list.value = list.value.filter((x) => x.id !== id);
  }
  async function execute(id: string) {
    return (await api.post(`/scenes/${id}/execute`)).data;
  }
  async function dryRun(id: string) {
    return (await api.post(`/scenes/${id}/execute/dry-run`)).data;
  }
  return { list, fetchAll, get, create, update, remove, execute, dryRun };
});
