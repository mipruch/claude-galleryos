import { EventEmitter } from 'events';
import { Socket } from 'net';
import type {
  CommandResult,
  ConnectionConfig,
  DriverContext,
  EndpointDescriptor,
  HealthStatus,
  IDeviceDriver,
} from '@galleryos/driver-core';
import { manifest } from './manifest';

export class TcpGenericDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private config!: ConnectionConfig;
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private connected = false;
  private connectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.config = config;
    this.ctx = ctx;
  }

  async connect(): Promise<void> {
    if (this.destroyed || this.connected) return;
    return new Promise((resolve) => {
      const sock = new Socket();
      const timeout = setTimeout(() => {
        sock.destroy();
        this.handleDisconnect('timeout');
        resolve();
      }, 5000);

      sock.once('connect', () => {
        clearTimeout(timeout);
        this.socket = sock;
        this.connected = true;
        this.connectAttempt = 0;
        this.ctx.logger.info('TCP connected', { host: this.config.host, port: this.config.port });
        this.emit('connected');
        resolve();
      });
      sock.on('error', (err) => {
        this.ctx.logger.warn('TCP socket error', { error: err.message });
      });
      sock.on('close', () => {
        clearTimeout(timeout);
        this.handleDisconnect('socket_closed');
        resolve();
      });
      sock.on('data', (buf) => {
        const msg = buf.toString('utf-8').trim();
        this.ctx.logger.debug('TCP rx', { msg });
      });

      sock.connect(this.config.port, this.config.host);
    });
  }

  private handleDisconnect(reason: string): void {
    if (!this.connected && !this.socket) return;
    this.connected = false;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.emit('disconnected', reason);
    if (!this.destroyed) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    const baseMs = 1000;
    const maxMs = 30000;
    const delay = Math.min(baseMs * 2 ** this.connectAttempt, maxMs);
    this.connectAttempt += 1;
    this.ctx.logger.info('TCP reconnect scheduled', { delay, attempt: this.connectAttempt });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { online: this.connected, checkedAt: new Date() };
  }

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult> {
    const start = Date.now();
    if (this.ctx.dryRun) {
      this.ctx.logger.info('Dry run', { command, params });
      return { success: true, durationMs: 0 };
    }
    if (!this.connected || !this.socket) {
      return { success: false, durationMs: 0, error: 'not_connected' };
    }
    const addr = endpoint.address as {
      sendString?: string;
      onString?: string;
      offString?: string;
    };

    let payload = '';
    let newState: Record<string, unknown> | undefined;

    switch (command) {
      case 'send':
        payload = String(params.payload ?? '');
        newState = { lastPayload: payload };
        break;
      case 'setLevel': {
        const level = Number(params.level ?? 0);
        payload = (addr.sendString ?? '').replace(/\{level\}/g, level.toString());
        newState = { level };
        break;
      }
      case 'on':
        payload = addr.onString ?? addr.sendString ?? 'ON';
        newState = { state: 'on' };
        break;
      case 'off':
        payload = addr.offString ?? addr.sendString ?? 'OFF';
        newState = { state: 'off' };
        break;
      default:
        return { success: false, durationMs: 0, error: `unknown_command:${command}` };
    }

    const lineTerm = (this.config.config.lineTerminator as string) ?? '\n';
    try {
      this.socket.write(payload + lineTerm);
      this.ctx.logger.debug('TCP tx', { payload });
      return { success: true, durationMs: Date.now() - start, state: newState };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(_endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    return {};
  }
}
