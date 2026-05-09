import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as IoServer } from 'socket.io';

import { config } from './config.js';
import { logger, childLogger } from './logger.js';
import { migrate } from './db/migrate.js';
import { deviceManager } from './core/DeviceManager.js';
import { sceneEngine } from './core/SceneEngine.js';
import { scheduler } from './core/Scheduler.js';
import { watchdog } from './core/Watchdog.js';
import { logWriter } from './core/LogWriter.js';
import { eventBus } from './core/EventBus.js';
import { startOscServer, stopOscServer } from './input/OscServer.js';
import { startTcpInputServer, stopTcpInputServer } from './input/TcpInputServer.js';
import { refreshMappings } from './input/InputMapper.js';
import { attachWebSocketHandlers } from './ws/handlers.js';

import roomsRoutes from './api/rooms.js';
import connectionsRoutes from './api/connections.js';
import devicesRoutes from './api/devices.js';
import scenesRoutes from './api/scenes.js';
import schedulesRoutes from './api/schedules.js';
import mappingsRoutes from './api/mappings.js';
import layoutsRoutes from './api/layouts.js';
import logsRoutes from './api/logs.js';
import systemRoutes from './api/system.js';
import { runSeedIfEmpty } from './db/seed.js';

const log = childLogger('bootstrap');

async function main(): Promise<void> {
  // Suppress noisy abort-on-uncaught — log instead.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { reason: String(reason) });
  });

  log.info('Starting GalleryOS server', { env: config.nodeEnv, port: config.port });

  await migrate();
  await runSeedIfEmpty();
  logWriter.start();

  await deviceManager.start();
  await scheduler.start();
  await refreshMappings();
  watchdog.start();

  startOscServer();
  startTcpInputServer();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await api.register(roomsRoutes);
      await api.register(connectionsRoutes);
      await api.register(devicesRoutes);
      await api.register(scenesRoutes);
      await api.register(schedulesRoutes);
      await api.register(mappingsRoutes);
      await api.register(layoutsRoutes);
      await api.register(logsRoutes);
      await api.register(systemRoutes);
    },
    { prefix: '/api/v1' }
  );

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info('Fastify listening', { port: config.port });

  const io = new IoServer(app.server, {
    cors: { origin: true },
    transports: ['websocket', 'polling'],
  });
  attachWebSocketHandlers(io);

  eventBus.emit('event', { type: 'system.startup.complete' });
  logger.info('GalleryOS server ready', { source: 'bootstrap' });

  const shutdown = async () => {
    log.info('Shutting down');
    stopOscServer();
    stopTcpInputServer();
    watchdog.stop();
    scheduler.stop();
    await deviceManager.stop();
    await logWriter.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Bootstrap failed', err);
  process.exit(1);
});
