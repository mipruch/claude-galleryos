import type { Server as IoServer, Socket } from 'socket.io';
import { eventBus } from '../core/EventBus.js';
import { sceneEngine } from '../core/SceneEngine.js';
import { deviceManager } from '../core/DeviceManager.js';
import { childLogger } from '../logger.js';

const log = childLogger('ws');

export function attachWebSocketHandlers(io: IoServer): void {
  io.on('connection', (socket: Socket) => {
    log.debug('WS client connected', { id: socket.id, ns: socket.nsp.name });
    socket.on('scene:execute', async (data: { sceneId: string }, ack?: Function) => {
      try {
        const result = await sceneEngine.executeScene(data.sceneId, { source: 'userui' });
        ack?.({ executionId: result.executionId });
      } catch (err) {
        ack?.({ error: err instanceof Error ? err.message : String(err) });
      }
    });
    socket.on(
      'device:command',
      async (
        data: { deviceId: string; command: string; params?: Record<string, unknown> },
        ack?: Function
      ) => {
        const result = await deviceManager.execute(
          data.deviceId,
          data.command,
          data.params ?? {}
        );
        ack?.(result);
      }
    );
    socket.on('disconnect', () => {
      log.debug('WS client disconnected', { id: socket.id });
    });
  });

  // Bridge EventBus → WebSocket broadcasts
  eventBus.on('event', (e: any) => {
    switch (e.type) {
      case 'device.state.changed':
        io.emit('device:state', {
          deviceId: e.deviceId,
          state: e.state,
          source: e.source,
          timestamp: new Date().toISOString(),
        });
        break;
      case 'device.online':
        io.emit('device:online', { deviceId: e.deviceId });
        break;
      case 'device.offline':
        io.emit('device:offline', { deviceId: e.deviceId, reason: e.reason });
        break;
      case 'scene.execute.started':
        io.emit('scene:started', {
          sceneId: e.sceneId,
          executionId: e.executionId,
          source: e.source,
        });
        break;
      case 'scene.execute.completed':
        io.emit('scene:completed', {
          sceneId: e.sceneId,
          executionId: e.executionId,
          durationMs: e.durationMs,
        });
        break;
      case 'scene.execute.failed':
        io.emit('scene:failed', {
          sceneId: e.sceneId,
          executionId: e.executionId,
          error: e.error,
        });
        break;
      case 'connection.error':
      case 'system.driver.crashed':
        io.emit('driver:error', {
          connectionId: e.connectionId,
          driverId: e.driverId ?? '',
          message: e.error ?? 'unknown',
        });
        break;
    }
  });

  eventBus.on('log.created', (p: any) => {
    if (p.level === 'debug') return;
    io.of('/admin').emit('log:entry', p);
  });
}
