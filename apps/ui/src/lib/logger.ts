/**
 * Lightweight structured logger for the UI, mirroring the server's ergonomics
 * (`logger.child("module")`, then `log.info(message, meta?)`). It writes to the
 * browser console with a timestamp, level and bound source tag, so front-end
 * activity — especially the camera streaming lifecycle — is as traceable as the
 * server logs.
 *
 * The threshold defaults to `debug` in dev and `info` in production builds, and
 * can be overridden with `VITE_LOG_LEVEL`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
}

function resolveThreshold(): LogLevel {
  const configured = import.meta.env?.VITE_LOG_LEVEL as LogLevel | undefined
  if (configured && configured in LEVEL_ORDER) return configured
  return import.meta.env?.DEV ? 'debug' : 'info'
}

const threshold = LEVEL_ORDER[resolveThreshold()]

/** A console logger bound to a fixed `source` (module name). */
export class UiLogger {
  constructor(private readonly source: string) {}

  /** Derive a child logger with a dotted sub-source (e.g. "ui.camera-view"). */
  child(source: string): UiLogger {
    return new UiLogger(`${this.source}.${source}`)
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.emit('debug', message, meta)
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, meta)
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, meta)
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, meta)
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < threshold) return
    const ts = new Date().toISOString()
    const prefix = `${ts} ${level.toUpperCase()} [${this.source}]`
    if (meta) console[CONSOLE_METHOD[level]](prefix, message, meta)
    else console[CONSOLE_METHOD[level]](prefix, message)
  }
}

/** Root UI logger. Use `logger.child("module")` per feature. */
export const logger = new UiLogger('ui')
