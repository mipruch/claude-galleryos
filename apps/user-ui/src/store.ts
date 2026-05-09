import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { api } from './api';
import { socket } from './socket';

export const useGalleryStore = defineStore('gallery', () => {
  const layout = ref<any>(null);
  const scenes = reactive<Record<string, any>>({});
  const sceneStatus = reactive<Record<string, 'idle' | 'executing' | 'active' | 'failed'>>({});
  const devices = reactive<Record<string, any>>({});
  const deviceStates = reactive<Record<string, any>>({});
  const deviceOnline = reactive<Record<string, boolean>>({});
  const wsConnected = ref(false);
  const toasts = ref<Array<{ id: number; level: string; message: string }>>([]);

  let toastSeq = 0;
  function pushToast(level: string, message: string) {
    const id = ++toastSeq;
    toasts.value.push({ id, level, message });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 4000);
  }

  async function load() {
    const [layoutR, scenesR, devicesR] = await Promise.all([
      api.get('/layouts', { params: { default: true } }),
      api.get('/scenes'),
      api.get('/devices'),
    ]);
    layout.value = layoutR.data;
    for (const s of scenesR.data) scenes[s.id] = s;
    for (const d of devicesR.data) devices[d.id] = d;

    socket.on('connect', () => (wsConnected.value = true));
    socket.on('disconnect', () => (wsConnected.value = false));
    socket.on('scene:started', (e: any) => (sceneStatus[e.sceneId] = 'executing'));
    socket.on('scene:completed', (e: any) => {
      sceneStatus[e.sceneId] = 'active';
      setTimeout(() => (sceneStatus[e.sceneId] = 'idle'), 3000);
    });
    socket.on('scene:failed', (e: any) => {
      sceneStatus[e.sceneId] = 'failed';
      pushToast('error', `Scéna selhala: ${e.error}`);
      setTimeout(() => (sceneStatus[e.sceneId] = 'idle'), 4000);
    });
    socket.on('device:state', (e: any) => (deviceStates[e.deviceId] = e.state));
    socket.on('device:online', (e: any) => (deviceOnline[e.deviceId] = true));
    socket.on('device:offline', (e: any) => (deviceOnline[e.deviceId] = false));
  }

  function executeScene(sceneId: string) {
    sceneStatus[sceneId] = 'executing';
    socket.emit('scene:execute', { sceneId }, (ack: any) => {
      if (ack?.error) {
        sceneStatus[sceneId] = 'failed';
        pushToast('error', `Nelze spustit scénu: ${ack.error}`);
        setTimeout(() => (sceneStatus[sceneId] = 'idle'), 3000);
      }
    });
  }

  function deviceCommand(deviceId: string, command: string, params: Record<string, unknown>) {
    socket.emit('device:command', { deviceId, command, params });
  }

  return {
    layout,
    scenes,
    devices,
    sceneStatus,
    deviceStates,
    deviceOnline,
    wsConnected,
    toasts,
    load,
    executeScene,
    deviceCommand,
  };
});
