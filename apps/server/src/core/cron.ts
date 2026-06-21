/**
 * Cron parsing + timezone-aware next-run computation — a pure, dependency-free
 * module shared by the {@link Scheduler} and the `/schedules/:id/next` preview.
 *
 * ⚠️ PLAN correction: §3 assumed `Temporal.ZonedDateTime` is built into Bun, but
 * it is not available in the runtime (Bun 1.3.x, no `--harmony-temporal`). We
 * therefore compute wall-clock ↔ UTC conversions with `Intl.DateTimeFormat`,
 * which is always present and fully timezone/DST aware.
 *
 * All returned timestamps are absolute UTC `Date`s. A job's cron expression is
 * interpreted in its own IANA timezone (e.g. `Europe/Prague`); display logic
 * converts back to local time. Because the {@link Scheduler} recomputes the next
 * occurrence after every fire, DST transitions are handled correctly: the offset
 * is recalculated fresh each time rather than assumed constant.
 *
 * Supports the standard 5-field cron grammar (minute hour day-of-month month
 * day-of-week) with `*`, lists (`1,2`), ranges (`1-5`), and steps (`*​/15`,
 * `0-30/10`). Day-of-week is 0–6 with Sunday = 0 (7 also accepted as Sunday).
 * When both day-of-month and day-of-week are restricted, a day matches if EITHER
 * field matches (Vixie-cron semantics).
 */

interface CronField {
  /** Set of allowed values for this field. */
  values: Set<number>;
  /** True when the field was `*` (unrestricted). */
  wildcard: boolean;
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

/** Thrown when a cron expression cannot be parsed. */
export class CronParseError extends Error {}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
  /** Largest value accepted in input (defaults to `max`); e.g. day-of-week 7 = Sun. */
  inputMax?: number;
  /** Map a raw token value into the canonical range (e.g. day-of-week 7 → 0). */
  normalize?: (n: number) => number;
}

const FIELD_SPECS: FieldSpec[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 6, inputMax: 7, normalize: (n) => n % 7 },
];

/** One comma-separated term resolved to an inclusive `lo..hi` stepped range. */
interface CronTerm {
  lo: number;
  hi: number;
  step: number;
  /** True only for a bare `*` (no step) — promotes the whole field to wildcard. */
  wildcard: boolean;
}

/** Resolve the "<range>" portion (before any `/step`) into `[lo, hi]` bounds. */
function parseRange(rangePart: string, noStep: boolean, spec: FieldSpec): Omit<CronTerm, "step"> {
  if (rangePart === "*") return { lo: spec.min, hi: spec.max, wildcard: noStep };
  if (rangePart.includes("-")) {
    const [a, b] = rangePart.split("-");
    return { lo: Number(a), hi: Number(b), wildcard: false };
  }
  const v = Number(rangePart);
  // A bare number with a step (e.g. "5/10") means "from 5 to max, every step".
  return { lo: v, hi: noStep ? v : spec.max, wildcard: false };
}

/** Parse one term ("*", "5", "1-5", "*​/15", "1-30/5") with full validation. */
function parseTerm(part: string, spec: FieldSpec): CronTerm {
  if (part === "") throw new CronParseError(`empty term in ${spec.name} field`);

  const slashIdx = part.indexOf("/");
  const rangePart = slashIdx === -1 ? part : part.slice(0, slashIdx);
  const stepPart = slashIdx === -1 ? undefined : part.slice(slashIdx + 1);

  let step = 1;
  if (stepPart !== undefined) {
    step = Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) {
      throw new CronParseError(`invalid step in ${spec.name} field: "${part}"`);
    }
  }

  const { lo, hi, wildcard } = parseRange(rangePart, stepPart === undefined, spec);
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    throw new CronParseError(`non-integer value in ${spec.name} field: "${part}"`);
  }
  const inputMax = spec.inputMax ?? spec.max;
  if (lo < spec.min || hi > inputMax || lo > hi) {
    throw new CronParseError(
      `out-of-range value in ${spec.name} field: "${part}" (allowed ${spec.min}-${spec.max})`,
    );
  }
  return { lo, hi, step, wildcard };
}

/**
 * Parse a whole cron field (one of minute/hour/…) into the set of values it
 * permits. Handles `*`, comma lists, `a-b` ranges, and `*​/n` / `a-b/n` steps.
 */
function parseField(raw: string, spec: FieldSpec): CronField {
  const values = new Set<number>();
  let wildcard = false;

  for (const part of raw.split(",")) {
    const term = parseTerm(part, spec);
    if (term.wildcard) wildcard = true;
    for (let v = term.lo; v <= term.hi; v += term.step) {
      values.add(spec.normalize ? spec.normalize(v) : v);
    }
  }

  if (values.size === 0) throw new CronParseError(`no values in ${spec.name} field: "${raw}"`);
  return { values, wildcard };
}

/**
 * Parse a 5-field cron expression. Throws {@link CronParseError} on a malformed
 * expression — callers (the schedules route) surface this as an HTTP 400.
 */
export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(`expected 5 cron fields, got ${fields.length}: "${expr}"`);
  }
  const parsed = fields.map((f, i) => parseField(f, FIELD_SPECS[i]!));
  return {
    minute: parsed[0]!,
    hour: parsed[1]!,
    dayOfMonth: parsed[2]!,
    month: parsed[3]!,
    dayOfWeek: parsed[4]!,
  };
}

/** Validate a cron expression without keeping the result. Returns true if valid. */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

// ── timezone helpers (Intl-based; no Temporal) ───────────────────

/** Wall-clock fields of an instant, as observed in a given timezone. */
interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
  /** Day of week, Sunday = 0. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// One formatter per timezone is reused across calls (constructing them is costly).
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      throw new CronParseError(`invalid timezone: "${timeZone}"`);
    }
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Decompose a UTC instant into the wall-clock time observed in `timeZone`. */
function toWallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  // Some engines render midnight as hour "24"; normalise to 0.
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday ?? "Sun"] ?? 0,
  };
}

/** Offset (ms) of `timeZone` from UTC at a given instant (positive = ahead of UTC). */
function offsetMs(instant: Date, timeZone: string): number {
  const wc = toWallClock(instant, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  // asUtc treats the wall-clock fields as if UTC; the gap to the real instant
  // (truncated to whole seconds) is the zone offset.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time in `timeZone` to the absolute UTC instant. Two-pass
 * to stay correct across DST: the offset is sampled at a first guess, then
 * re-sampled at the resulting instant and corrected if the boundary shifted it.
 */
function wallClockToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const guess = wallAsUtc - offsetMs(new Date(wallAsUtc), timeZone);
  const corrected = wallAsUtc - offsetMs(new Date(guess), timeZone);
  return new Date(corrected);
}

// ── matching + next-run search ───────────────────────────────────

/** Does a wall-clock minute satisfy the parsed cron's day/time fields? */
function matches(cron: ParsedCron, wc: WallClock): boolean {
  if (!cron.minute.values.has(wc.minute)) return false;
  if (!cron.hour.values.has(wc.hour)) return false;
  if (!cron.month.values.has(wc.month)) return false;

  // Vixie semantics: if both day fields are restricted, match on EITHER; if only
  // one is restricted, that one governs; if both are `*`, every day matches.
  const domOk = cron.dayOfMonth.values.has(wc.day);
  const dowOk = cron.dayOfWeek.values.has(wc.weekday);
  if (cron.dayOfMonth.wildcard && cron.dayOfWeek.wildcard) return true;
  if (!cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard) return domOk || dowOk;
  if (!cron.dayOfMonth.wildcard) return domOk;
  return dowOk;
}

// Search bound (minutes). ~5 years comfortably covers sparse expressions like
// "0 0 29 2 *" (Feb 29) while guaranteeing termination on an impossible one.
const MAX_SEARCH_MINUTES = 5 * 366 * 24 * 60;

/**
 * Compute the next `count` UTC fire times of `cronExpr` interpreted in `timeZone`,
 * strictly after `from` (default now). Iterates wall-clock minutes in the target
 * zone and converts each match back to UTC, so DST gaps/overlaps resolve naturally.
 *
 * @throws {CronParseError} if the expression or timezone is invalid.
 */
export function computeNextRuns(
  cronExpr: string,
  timeZone: string,
  count: number,
  from: Date = new Date(),
): Date[] {
  const cron = parseCron(cronExpr);
  formatterFor(timeZone); // validate the zone up front

  const results: Date[] = [];
  if (count <= 0) return results;

  // Walk wall-clock minutes using a "fake-UTC" Date whose getUTC* fields are the
  // target zone's wall clock. Seed it from `from` shifted by the current offset.
  const cursor = new Date(from.getTime() + offsetMs(from, timeZone));
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1); // start at the next whole minute

  let lastEmitted = -1;
  for (let i = 0; i < MAX_SEARCH_MINUTES && results.length < count; i++) {
    const wc: WallClock = {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
      hour: cursor.getUTCHours(),
      minute: cursor.getUTCMinutes(),
      second: 0,
      weekday: cursor.getUTCDay(),
    };
    if (matches(cron, wc)) {
      const utc = wallClockToUtc(wc.year, wc.month, wc.day, wc.hour, wc.minute, timeZone);
      const ms = utc.getTime();
      // Guard against DST-fold duplicates and times that resolve to <= from.
      if (ms > from.getTime() && ms !== lastEmitted) {
        results.push(utc);
        lastEmitted = ms;
      }
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return results;
}

/** The single next UTC fire time, or `undefined` if none within the search bound. */
export function computeNextRun(
  cronExpr: string,
  timeZone: string,
  from: Date = new Date(),
): Date | undefined {
  return computeNextRuns(cronExpr, timeZone, 1, from)[0];
}
