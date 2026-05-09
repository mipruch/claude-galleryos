import { ChildProcess, fork } from 'child_process';
import { randomUUID } from 'crypto';
import type {
  CommandResult,
  ConnectionConfig,
  CoreToDriverMessage,
  DriverToCoreMessage,
  EndpointDescriptor,
  HealthStatus,
} from '@galleryos/driver-core';
import { config as appConfig } from '../config.js';
import { eventBus } from '../core/EventBus.js';
import { DRIVER_ENTRYPOINT_PATH, getDriver } from '../core/DriverRegistry.js';
import { childLogger } from '../logger.js';

const log = childLogger('driver_host');

interface PendingReply {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

interface DriverInstance {
  connectionId: string;
  driverId: string;
  config: ConnectionConfig;
  process: ChildProcess | null;
  ready: boolean;
  attempts: number;
  pending: Map<string, PendingReply>;
  restartTimer: NodeJS.Timeout | null;
  destroyed: boolean;
  online: boolean;
}

const REQUEST_TIMEOUT_MS = 7000;

export class DriverHost {
  private instances = new Map<string, DriverInstance>();

  async start(connection: ConnectionConfig & { driverId: string }): Promise<void> {
    const reg = getDriver(connection.driverId);
    if (!reg) throw new Error(`unknown_driver:${connection.driverId}`);

    if (this.instances.has(connection.id)) {
      log.warn('Driver instance already started', { connectionId: connection.id });
      return;
    }
    const inst: DriverInstance = {
      connectionId: connection.id,
      driverId: connection.driverId,
      config: connection,
      process: null,
      ready: false,
      attempts: 0,
      pending: new Map(),
      restartTimer: null,
      destroyed: false,
      online: false,
    };
    this.instances.set(connection.id, inst);
    this.spawn(inst);
  }

  async stop(connectionId: string): Promise<void> {
    const inst = this.instances.get(connectionId);
    if (!inst) return;
    inst.destroyed = true;
    if (inst.restartTimer) clearTimeout(inst.restartTimer);
    if (inst.process) {
      try {
        inst.process.send({ type: 'destroy' } satisfies CoreToDriverMessage);
      } catch {
        /* ignore */
      }
      inst.process.kill('SIGTERM');
    }
    for (const pending of inst.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('driver_destroyed'));
    }
    this.instances.delete(connectionId);
  }

  async stopAll(): Promise<void> {
    const ids = [...this.instances.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  isOnline(connectionId: string): boolean {
    return this.instances.get(connectionId)?.online ?? false;
  }

  private spawn(inst: DriverInstance): void {
    const reg = getDriver(inst.driverId);
    if (!reg) {
      log.error('Cannot spawn driver: unknown', { driverId: inst.driverId });
      return;
    }

    const isTs = DRIVER_ENTRYPOINT_PATH.endsWith('.ts');
    const execArgv = isTs ? ['--import', 'tsx/esm'] : process.execArgv;
    const child = fork(
      DRIVER_ENTRYPOINT_PATH,
      [inst.connectionId, inst.driverId, reg.modulePath],
      {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        execArgv,
        env: {
          ...process.env,
          DRIVER_CONNECTION_ID: inst.connectionId,
          DRIVER_ID: inst.driverId,
          DRIVER_MODULE: reg.modulePath,
        },
      }
    );

    inst.process = child;
    inst.ready = false;

    child.on('message', (msg: DriverToCoreMessage) => this.onDriverMessage(inst, msg));
    child.on('exit', (code, signal) => this.onDriverExit(inst, code, signal));
    child.on('error', (err) =>
      log.warn('Driver subprocess error', {
        connectionId: inst.connectionId,
        error: err.message,
      })
    );

    // Send init + connect.
    const initMsg: CoreToDriverMessage = {
      type: 'init',
      config: inst.config,
      context: { dryRun: false },
    };
    child.send(initMsg);
    child.send({ type: 'connect' } satisfies CoreToDriverMessage);
  }

  private onDriverMessage(inst: DriverInstance, msg: DriverToCoreMessage): void {
    switch (msg.type) {
      case 'ready':
        inst.ready = true;
        break;
      case 'connected':
        inst.online = true;
        inst.attempts = 0;
        log.info('Driver connected', { connectionId: inst.connectionId });
        eventBus.emit('event', {
          type: 'connection.connected',
          connectionId: inst.connectionId,
        });
        break;
      case 'disconnected':
        inst.online = false;
        log.warn('Driver disconnected', {
          connectionId: inst.connectionId,
          reason: msg.reason,
        });
        eventBus.emit('event', {
          type: 'connection.disconnected',
          connectionId: inst.connectionId,
          reason: msg.reason,
        });
        break;
      case 'state':
        eventBus.emit('driver.state', {
          connectionId: inst.connectionId,
          event: msg.event,
        });
        break;
      case 'error':
        log.warn('Driver error', { connectionId: inst.connectionId, error: msg.error });
        eventBus.emit('event', {
          type: 'connection.error',
          connectionId: inst.connectionId,
          error: msg.error.message,
        });
        break;
      case 'reply': {
        const pending = inst.pending.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        inst.pending.delete(msg.requestId);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
        break;
      }
      case 'log':
        log.log(msg.level, msg.message, {
          connectionId: inst.connectionId,
          driverId: inst.driverId,
          ...msg.meta,
        });
        break;
    }
  }

  private onDriverExit(inst: DriverInstance, code: number | null, signal: string | null): void {
    inst.ready = false;
    inst.online = false;
    inst.process = null;
    for (const pending of inst.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('driver_exited'));
    }
    inst.pending.clear();

    if (inst.destroyed) return;

    log.warn('Driver subprocess exited', {
      connectionId: inst.connectionId,
      code,
      signal,
      attempt: inst.attempts,
    });
    eventBus.emit('event', {
      type: 'system.driver.crashed',
      connectionId: inst.connectionId,
      driverId: inst.driverId,
      error: `exit_code:${code}`,
    });

    if (
      appConfig.driverRestartMaxAttempts > 0 &&
      inst.attempts >= appConfig.driverRestartMaxAttempts
    ) {
      log.error('Max driver restart attempts reached', { connectionId: inst.connectionId });
      return;
    }

    const delay = Math.min(
      appConfig.driverRestartBaseDelayMs * 2 ** inst.attempts,
      appConfig.driverRestartMaxDelayMs
    );
    inst.attempts += 1;
    inst.restartTimer = setTimeout(() => {
      inst.restartTimer = null;
      if (!inst.destroyed) this.spawn(inst);
    }, delay);
  }

  private sendRequest<T>(connectionId: string, msg: CoreToDriverMessage): Promise<T> {
    const inst = this.instances.get(connectionId);
    if (!inst || !inst.process) return Promise.reject(new Error('driver_not_running'));
    if (!('requestId' in msg)) return Promise.reject(new Error('invalid_request'));

    const requestId = msg.requestId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        inst.pending.delete(requestId);
        reject(new Error('driver_request_timeout'));
      }, REQUEST_TIMEOUT_MS);
      inst.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      inst.process!.send(msg, (err) => {
        if (err) {
          clearTimeout(timer);
          inst.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  executeCommand(
    connectionId: string,
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult> {
    const requestId = randomUUID();
    return this.sendRequest<CommandResult>(connectionId, {
      type: 'executeCommand',
      requestId,
      endpoint,
      command,
      params,
    });
  }

  readState(
    connectionId: string,
    endpoint: EndpointDescriptor
  ): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    return this.sendRequest<Record<string, unknown>>(connectionId, {
      type: 'readState',
      requestId,
      endpoint,
    });
  }

  healthCheck(connectionId: string): Promise<HealthStatus> {
    const requestId = randomUUID();
    return this.sendRequest<HealthStatus>(connectionId, { type: 'healthCheck', requestId });
  }

  endpointHealthCheck(
    connectionId: string,
    endpoint: EndpointDescriptor
  ): Promise<HealthStatus> {
    // Implemented as readState for MVP — drivers may override later.
    return this.readState(connectionId, endpoint).then(() => ({
      online: this.isOnline(connectionId),
      checkedAt: new Date(),
    }));
  }

  discoverEndpoints(connectionId: string): Promise<EndpointDescriptor[]> {
    const requestId = randomUUID();
    return this.sendRequest<EndpointDescriptor[]>(connectionId, {
      type: 'discoverEndpoints',
      requestId,
    });
  }

  subscribeEndpoint(connectionId: string, endpoint: EndpointDescriptor): void {
    const inst = this.instances.get(connectionId);
    if (!inst?.process) return;
    inst.process.send({ type: 'subscribeToEndpoint', endpoint } satisfies CoreToDriverMessage);
  }

  unsubscribeEndpoint(connectionId: string, endpoint: EndpointDescriptor): void {
    const inst = this.instances.get(connectionId);
    if (!inst?.process) return;
    inst.process.send({
      type: 'unsubscribeFromEndpoint',
      endpoint,
    } satisfies CoreToDriverMessage);
  }

  status(): Array<{ connectionId: string; driverId: string; ready: boolean; attempts: number }> {
    return [...this.instances.values()].map((i) => ({
      connectionId: i.connectionId,
      driverId: i.driverId,
      ready: i.ready,
      attempts: i.attempts,
    }));
  }
}

export const driverHost = new DriverHost();
