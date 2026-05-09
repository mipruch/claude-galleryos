import winston from 'winston';
import { config } from './config.js';
import { eventBus } from './core/EventBus.js';

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, source, ...rest }) => {
    const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${timestamp} ${level} [${source ?? 'app'}] ${message}${meta}`;
  })
);

export const logger = winston.createLogger({
  level: config.logLevel,
  defaultMeta: { source: 'app' },
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
  ],
});

// Database transport — re-exported from logs.ts; here we just emit on EventBus
// so a separate writer can persist asynchronously.
export interface LogPayload {
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  message: string;
  metadata: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  durationMs?: number;
  ts: string;
}

export function emitLogEvent(p: LogPayload): void {
  eventBus.emit('log.created', p);
}

export function childLogger(source: string) {
  return logger.child({ source });
}
