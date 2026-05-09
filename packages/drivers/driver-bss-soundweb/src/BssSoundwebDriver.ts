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
import {
  type BssAddress,
  encodeSetParam,
  encodeSubscribe,
  encodeUnsubscribe,
  levelToRaw,
} from './hiqnet';

export class BssSoundwebDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private config!: ConnectionConfig;
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private connected = false;
  private destroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectAttempt = 0;
  private subscribedEndpoints = new Map<string, EndpointDescriptor>();

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
        this.handleDisconnect('connect_timeout');
        resolve();
      }, 5000);

      sock.once('connect', () => {
        clearTimeout(timeout);
        this.socket = sock;
        this.connected = true;
        this.connectAttempt = 0;
        this.ctx.logger.info('BSS connected', { host: this.config.host });
        // Re-subscribe surviving endpoints
        for (const ep of this.subscribedEndpoints.values()) {
          this.sendSubscribe(ep).catch(() => {});
        }
        this.emit('connected');
        resolve();
      });
      sock.on('data', (chunk) => this.handleData(chunk));
      sock.on('error', (err) => {
        this.ctx.logger.warn('BSS socket error', { error: err.message });
      });
      sock.on('close', () => {
        clearTimeout(timeout);
        this.handleDisconnect('socket_closed');
        resolve();
      });
      sock.connect(this.config.port || 1023, this.config.host);
    });
  }

  private handleData(chunk: Buffer): void {
    // MVP: log incoming bytes; full parser would unescape DLE, validate checksum,
    // dispatch SET / PARAM_REPLY frames and emit 'state' events.
    this.ctx.logger.debug('BSS rx', { len: chunk.length });
  }

  private handleDisconnect(reason: string): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected', reason);
    }
    if (!this.destroyed) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.destroyed) return;
    const delay = Math.min(1000 * 2 ** this.connectAttempt, 30000);
    this.connectAttempt += 1;
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
    this.subscribedEndpoints.clear();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { online: this.connected, checkedAt: new Date() };
  }

  private addressFrom(endpoint: EndpointDescriptor): BssAddress {
    const a = endpoint.address as { virtualDevice: number; object: number; parameter: number };
    return {
      nodeId: Number(this.config.config.nodeId ?? 0),
      virtualDevice: a.virtualDevice,
      object: a.object,
      parameter: a.parameter,
    };
  }

  private writeFrame(buf: Buffer): boolean {
    if (!this.socket || !this.connected) return false;
    try {
      this.socket.write(buf);
      return true;
    } catch (err) {
      this.ctx.logger.warn('BSS write error', { error: String(err) });
      return false;
    }
  }

  private async sendSubscribe(endpoint: EndpointDescriptor): Promise<void> {
    const frame = encodeSubscribe(this.addressFrom(endpoint));
    this.writeFrame(frame);
  }

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult> {
    const start = Date.now();
    if (this.ctx.dryRun) return { success: true, durationMs: 0 };
    if (!this.connected) {
      return { success: false, durationMs: 0, error: 'not_connected' };
    }

    const addr = this.addressFrom(endpoint);
    let newState: Record<string, unknown> | undefined;
    let frame: Buffer | null = null;

    switch (command) {
      case 'setLevel': {
        const level = Number(params.level ?? 0);
        const raw = levelToRaw(level);
        frame = encodeSetParam(addr, raw);
        newState = { level, rawValue: raw };
        break;
      }
      case 'setMute': {
        const muted = Boolean(params.muted);
        frame = encodeSetParam(addr, muted ? 1 : 0);
        newState = { muted };
        break;
      }
      case 'subscribe': {
        this.subscribedEndpoints.set(endpoint.id, endpoint);
        frame = encodeSubscribe(addr);
        break;
      }
      default:
        return { success: false, durationMs: 0, error: `unknown_command:${command}` };
    }

    if (!frame || !this.writeFrame(frame)) {
      return { success: false, durationMs: Date.now() - start, error: 'write_failed' };
    }
    return { success: true, durationMs: Date.now() - start, state: newState };
  }

  async readState(_endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    return {};
  }

  async subscribeToEndpoint(endpoint: EndpointDescriptor): Promise<void> {
    this.subscribedEndpoints.set(endpoint.id, endpoint);
    if (this.connected) await this.sendSubscribe(endpoint);
  }

  async unsubscribeFromEndpoint(endpoint: EndpointDescriptor): Promise<void> {
    this.subscribedEndpoints.delete(endpoint.id);
    if (this.connected) {
      this.writeFrame(encodeUnsubscribe(this.addressFrom(endpoint)));
    }
  }
}
