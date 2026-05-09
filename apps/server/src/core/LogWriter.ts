import Transport from 'winston-transport';
import { query } from '../db/index.js';
import { eventBus } from './EventBus.js';
import { childLogger, logger } from '../logger.js';

const log = childLogger('log_writer');

interface LogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  metadata: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  durationMs?: number;
}

class DbBufferTransport extends Transport {
  log(info: any, next: () => void): void {
    setImmediate(() => this.emit('logged', info));
    const { level, message, source, ...rest } = info;
    eventBus.emit('log.created', {
      level,
      source: source ?? 'app',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      metadata: rest,
    });
    next();
  }
}

class LogWriter {
  private buffer: LogPayload[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  start(): void {
    eventBus.on('log.created', (p: LogPayload) => this.buffer.push(p));
    this.flushInterval = setInterval(() => void this.flush(), 1000);
    logger.add(new DbBufferTransport({ level: 'info' }));
  }

  async stop(): Promise<void> {
    if (this.flushInterval) clearInterval(this.flushInterval);
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let i = 1;
      for (const p of batch) {
        placeholders.push(
          `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`
        );
        values.push(
          p.level,
          p.source,
          p.entityType ?? null,
          p.entityId ?? null,
          p.message,
          JSON.stringify(p.metadata ?? {}),
          p.durationMs ?? null
        );
      }
      await query(
        `INSERT INTO logs (level, source, entity_type, entity_id, message, metadata, duration_ms)
         VALUES ${placeholders.join(', ')}`,
        values
      );
    } catch (err) {
      log.warn('Failed to flush logs', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const logWriter = new LogWriter();
