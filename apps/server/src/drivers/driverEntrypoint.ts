// Subprocess entrypoint executed by DriverHost via child_process.fork.
// Loads the driver module dynamically by package name (third argv) and bridges
// IPC messages <-> driver instance.

import type {
  CoreToDriverMessage,
  DriverContext,
  DriverToCoreMessage,
  IDeviceDriver,
} from '@galleryos/driver-core';

const [, , connectionId, driverId, modulePath] = process.argv;

function send(msg: DriverToCoreMessage): void {
  if (process.send) process.send(msg);
}

function makeLogger(): DriverContext['logger'] {
  const log = (level: 'debug' | 'info' | 'warn' | 'error') => (message: string, meta?: object) =>
    send({ type: 'log', level, message, meta });
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
}

class NoopKVStore {
  private map = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

const abortController = new AbortController();
const ctx: DriverContext = {
  logger: makeLogger(),
  storage: new NoopKVStore(),
  dryRun: false,
  signal: abortController.signal,
};

let driver: IDeviceDriver | null = null;

async function loadDriver(): Promise<IDeviceDriver> {
  const mod = await import(modulePath);
  const DriverCtor = mod.default ?? mod[Object.keys(mod)[0]];
  if (typeof DriverCtor !== 'function') {
    throw new Error(`driver_module_has_no_default_class:${modulePath}`);
  }
  return new DriverCtor() as IDeviceDriver;
}

function attachListeners(d: IDeviceDriver): void {
  d.on('connected', () => send({ type: 'connected' }));
  d.on('disconnected', (reason: string) => send({ type: 'disconnected', reason }));
  d.on('state', (event) => send({ type: 'state', event }));
  d.on('error', (error) => send({ type: 'error', error }));
}

process.on('message', (msg: CoreToDriverMessage) => {
  void handleMessage(msg);
});

process.on('SIGTERM', async () => {
  abortController.abort();
  if (driver) {
    try {
      await driver.destroy();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
});

async function handleMessage(msg: CoreToDriverMessage): Promise<void> {
  try {
    switch (msg.type) {
      case 'init':
        driver = await loadDriver();
        attachListeners(driver);
        await driver.init({ ...msg.config, driver: driverId }, {
          ...ctx,
          dryRun: msg.context.dryRun,
        });
        send({ type: 'ready' });
        break;
      case 'connect':
        if (driver) await driver.connect();
        break;
      case 'disconnect':
        if (driver) await driver.disconnect();
        break;
      case 'destroy':
        if (driver) await driver.destroy();
        process.exit(0);
        break;
      case 'executeCommand': {
        if (!driver) {
          send({
            type: 'reply',
            requestId: msg.requestId,
            result: null,
            error: 'driver_not_ready',
          });
          return;
        }
        try {
          const result = await driver.executeCommand(msg.endpoint, msg.command, msg.params);
          send({ type: 'reply', requestId: msg.requestId, result });
        } catch (err) {
          send({
            type: 'reply',
            requestId: msg.requestId,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'readState': {
        if (!driver) {
          send({ type: 'reply', requestId: msg.requestId, result: {}, error: 'driver_not_ready' });
          return;
        }
        try {
          const result = await driver.readState(msg.endpoint);
          send({ type: 'reply', requestId: msg.requestId, result });
        } catch (err) {
          send({
            type: 'reply',
            requestId: msg.requestId,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'healthCheck': {
        if (!driver) {
          send({
            type: 'reply',
            requestId: msg.requestId,
            result: { online: false, checkedAt: new Date() },
          });
          return;
        }
        try {
          const result = await driver.healthCheck();
          send({ type: 'reply', requestId: msg.requestId, result });
        } catch (err) {
          send({
            type: 'reply',
            requestId: msg.requestId,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case 'subscribeToEndpoint':
        if (driver?.subscribeToEndpoint) await driver.subscribeToEndpoint(msg.endpoint);
        break;
      case 'unsubscribeFromEndpoint':
        if (driver?.unsubscribeFromEndpoint) await driver.unsubscribeFromEndpoint(msg.endpoint);
        break;
      case 'discoverEndpoints': {
        if (!driver?.discoverEndpoints) {
          send({ type: 'reply', requestId: msg.requestId, result: [] });
          return;
        }
        try {
          const result = await driver.discoverEndpoints();
          send({ type: 'reply', requestId: msg.requestId, result });
        } catch (err) {
          send({
            type: 'reply',
            requestId: msg.requestId,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
    }
  } catch (err) {
    send({
      type: 'error',
      error: {
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

ctx.logger.info('Driver subprocess started', { connectionId, driverId, modulePath });
