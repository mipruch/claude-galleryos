import { EventEmitter } from 'events';
import { Socket } from 'net';
import { createHash } from 'crypto';
import type {
  CommandResult,
  ConnectionConfig,
  DriverContext,
  EndpointDescriptor,
  HealthStatus,
  IDeviceDriver,
} from '@galleryos/driver-core';
import { manifest } from './manifest';

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class PjlinkDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private config!: ConnectionConfig;
  private ctx!: DriverContext;
  private socket: Socket | null = null;
  private connected = false;
  private greeting: { authRequired: boolean; nonce?: string } | null = null;
  private rxBuffer = '';
  private pending: PendingRequest | null = null;
  private destroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectAttempt = 0;

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
        this.ctx.logger.info('PJLink TCP open', { host: this.config.host });
      });
      sock.on('data', (chunk) => this.handleData(chunk));
      sock.on('error', (err) => {
        this.ctx.logger.warn('PJLink socket error', { error: err.message });
      });
      sock.on('close', () => {
        clearTimeout(timeout);
        this.handleDisconnect('socket_closed');
        resolve();
      });
      sock.connect(this.config.port || 4352, this.config.host);

      const greetingTimer = setTimeout(() => {
        if (!this.connected && this.socket) {
          this.handleDisconnect('greeting_timeout');
        }
      }, 5000);
      this.once('connected', () => clearTimeout(greetingTimer));
      this.once('disconnected', () => {
        clearTimeout(greetingTimer);
        resolve();
      });
    });
  }

  private handleData(chunk: Buffer): void {
    this.rxBuffer += chunk.toString('utf-8');

    // Greeting line ends in \r
    while (this.rxBuffer.includes('\r')) {
      const idx = this.rxBuffer.indexOf('\r');
      const line = this.rxBuffer.slice(0, idx).trim();
      this.rxBuffer = this.rxBuffer.slice(idx + 1);

      if (!this.greeting) {
        this.parseGreeting(line);
      } else {
        this.handleResponse(line);
      }
    }
  }

  private parseGreeting(line: string): void {
    // PJLINK 0  (no auth) | PJLINK 1 <random>  (auth required)
    if (line.startsWith('PJLINK 0')) {
      this.greeting = { authRequired: false };
      this.connected = true;
      this.connectAttempt = 0;
      this.emit('connected');
      return;
    }
    const m = line.match(/^PJLINK 1 (\w+)/);
    if (m) {
      const nonce = m[1];
      this.greeting = { authRequired: true, nonce };
      const password = (this.config.config.password as string) || '';
      const hash = createHash('md5').update(nonce + password).digest('hex');
      // Auth is sent on the first command — store hash
      (this.greeting as any).hash = hash;
      this.connected = true;
      this.connectAttempt = 0;
      this.emit('connected');
      return;
    }
    this.ctx.logger.warn('PJLink unknown greeting', { line });
  }

  private handleResponse(line: string): void {
    if (!this.pending) {
      this.ctx.logger.debug('PJLink unsolicited', { line });
      return;
    }
    clearTimeout(this.pending.timer);
    const r = this.pending;
    this.pending = null;
    r.resolve(line);
  }

  private async sendCommand(cmd: string): Promise<string> {
    if (!this.socket || !this.connected) throw new Error('not_connected');
    if (this.pending) throw new Error('pending_command');

    const prefix =
      this.greeting?.authRequired && (this.greeting as any).hash
        ? (this.greeting as any).hash
        : '';
    const payload = prefix + cmd + '\r';

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('command_timeout'));
      }, 3000);
      this.pending = { resolve, reject, timer };
      this.socket!.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        }
      });
    });
  }

  private handleDisconnect(reason: string): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('disconnected'));
      this.pending = null;
    }
    this.greeting = null;
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
    this.greeting = null;
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
    _endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult> {
    const start = Date.now();
    if (this.ctx.dryRun) return { success: true, durationMs: 0 };
    if (!this.connected) {
      return { success: false, durationMs: 0, error: 'not_connected' };
    }

    try {
      let pjCmd: string;
      let newState: Record<string, unknown> | undefined;
      switch (command) {
        case 'on':
          pjCmd = '%1POWR 1';
          newState = { power: 'warmup' };
          break;
        case 'off':
          pjCmd = '%1POWR 0';
          newState = { power: 'cooling' };
          break;
        case 'setInput':
          pjCmd = `%1INPT ${params.input}`;
          newState = { input: String(params.input) };
          break;
        case 'getStatus':
          pjCmd = '%1POWR ?';
          break;
        default:
          return { success: false, durationMs: 0, error: `unknown_command:${command}` };
      }

      const resp = await this.sendCommand(pjCmd);
      this.ctx.logger.debug('PJLink resp', { resp });

      if (resp.includes('ERR')) {
        return { success: false, durationMs: Date.now() - start, error: resp };
      }
      if (command === 'getStatus') {
        const m = resp.match(/%1POWR=(\d)/);
        if (m) {
          const powerMap: Record<string, string> = { '0': 'off', '1': 'on', '2': 'cooling', '3': 'warmup' };
          newState = { power: powerMap[m[1]] ?? 'unknown' };
        }
      }
      return { success: true, durationMs: Date.now() - start, state: newState };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(_endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (!this.connected) return {};
    try {
      const resp = await this.sendCommand('%1POWR ?');
      const m = resp.match(/%1POWR=(\d)/);
      if (m) {
        const map: Record<string, string> = { '0': 'off', '1': 'on', '2': 'cooling', '3': 'warmup' };
        return { power: map[m[1]] ?? 'unknown' };
      }
      return {};
    } catch {
      return {};
    }
  }
}
