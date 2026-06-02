/**
 * Structured logging built on Winston.
 *
 * A thin {@link Logger} wrapper preserves an ergonomic API across the codebase:
 *  - `logger.child("module")` binds a fixed `source`
 *  - `log.info(message, meta?)` with a structured meta object
 *
 * Transports: colourised console (human-readable in dev, JSON in prod) plus a
 * rotating file. A TimescaleDB transport can be added later via
 * `winston.add(...)` without touching call sites.
 */

import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import winston from "winston";
import { config } from "./config.ts";

/** Render a meta object defensively (never throw from the logger). */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable meta]";
  }
}

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, source, ...rest } = info as Record<string, unknown>;
    const metaKeys = Object.keys(rest);
    const meta = metaKeys.length ? " " + safeJson(rest) : "";
    return `${timestamp as string} ${level} [${(source as string) ?? "core"}] ${message}${meta}`;
  }),
);

const prodFormat = winston.format.combine(winston.format.timestamp(), winston.format.json());

const transports: winston.transport[] = [
  new winston.transports.Console({ format: config.isProd ? prodFormat : devFormat }),
];

// Rotating file transport (best-effort — never block startup on FS issues).
try {
  mkdirSync(dirname(config.log.filePath), { recursive: true });
  transports.push(
    new winston.transports.File({
      filename: config.log.filePath,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      format: prodFormat,
    }),
  );
} catch {
  // Console transport alone is fine.
}

const root = winston.createLogger({ level: config.log.level, transports });

/** Ergonomic wrapper around a Winston logger with a bound `source`. */
export class Logger {
  constructor(private readonly wl: winston.Logger) {}

  /** Create a logger bound to a fixed source (module name). */
  child(source: string): Logger {
    return new Logger(this.wl.child({ source }));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.wl.debug(message, meta);
  }
  info(message: string, meta?: Record<string, unknown>): void {
    this.wl.info(message, meta);
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.wl.warn(message, meta);
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.wl.error(message, meta);
  }
}

/** Root logger. Use `logger.child("module")` per module. */
export const logger = new Logger(root);

/** Access the underlying Winston logger to add transports (e.g. DB sink). */
export const winstonRoot = root;
