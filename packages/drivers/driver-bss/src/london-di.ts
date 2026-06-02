/**
 * London DI protocol codec — BSS Soundweb London "Direct Inject".
 *
 * This is the wire protocol used by Soundweb London (BLU-…) DSPs over TCP 1023.
 * It is a pure, dependency-free module so it can be unit-tested in isolation.
 *
 * Frame layout (per the Soundweb London Third Party Control manual):
 *
 *   STX(0x02) │ <substituted( body │ checksum )> │ ETX(0x03)
 *
 *   body     = type(1) │ node(2) │ virtualDevice(1) │ object(3) │ param(2) │ value(4)
 *   checksum = single-byte XOR of every byte in `body` (computed BEFORE substitution)
 *
 * Byte substitution escapes the five reserved control bytes so they can never
 * appear inside the framed body. Substitution is applied to body+checksum AFTER
 * the checksum is computed, and increases the message length:
 *
 *   0x02 → 0x1B 0x82   0x03 → 0x1B 0x83   0x06 → 0x1B 0x86
 *   0x15 → 0x1B 0x95   0x1B → 0x1B 0x9B
 *
 * Values are 32-bit signed big-endian. Two encodings exist:
 *   - raw     (SET / SUBSCRIBE):           device-specific scaling law
 *   - percent (SET_PERCENT / SUBSCRIBE_…): raw = percent × 65536, range 0–100%
 *
 * Reads use SUBSCRIBE (there is no GET): the device replies immediately with a
 * SET / SET_PERCENT carrying the current value, then on every subsequent change.
 */

// ── control bytes ────────────────────────────────────────────
const STX = 0x02;
const ETX = 0x03;
const ESC = 0x1b;

/** reserved byte → escaped second byte (the first is always ESC 0x1B). */
const SUBSTITUTE: Readonly<Record<number, number>> = {
  0x02: 0x82,
  0x03: 0x83,
  0x06: 0x86,
  0x15: 0x95,
  0x1b: 0x9b,
};
/** reverse map: escaped second byte → original reserved byte. */
const UNSUBSTITUTE: Readonly<Record<number, number>> = {
  0x82: 0x02,
  0x83: 0x03,
  0x86: 0x06,
  0x95: 0x15,
  0x9b: 0x1b,
};

// ── message types (first body byte) ──────────────────────────
export const MsgType = {
  SET: 0x88,
  SUBSCRIBE: 0x89,
  UNSUBSCRIBE: 0x8a,
  RECALL_PRESET: 0x8c,
  SET_PERCENT: 0x8d,
  SUBSCRIBE_PERCENT: 0x8e,
  UNSUBSCRIBE_PERCENT: 0x8f,
  BUMP_PERCENT: 0x90,
  SET_STRING: 0x91,
} as const;

export type MsgTypeValue = (typeof MsgType)[keyof typeof MsgType];

/** Hierarchical address of one parameter inside a Soundweb device. */
export interface ParameterAddress {
  /** Physical device id, 1..65534 (two bytes). */
  node: number;
  /** Processing object category: Audio 0x03, Logic 0x02 (one byte). */
  virtualDevice: number;
  /** Processing object id, 0..0xFFFFFF (three bytes). */
  object: number;
  /** Parameter id within the object, 0..0xFFFF (two bytes). */
  param: number;
}

/** A fully decoded address-carrying message (SET, SET_PERCENT, …). */
export interface DiMessage extends ParameterAddress {
  type: number;
  /** 32-bit signed value (raw or percent-raw depending on `type`). */
  value: number;
}

// ── checksum & substitution ──────────────────────────────────

/** Single-byte XOR of all bytes (the London DI checksum). */
export function xorChecksum(bytes: readonly number[]): number {
  return bytes.reduce((acc, b) => acc ^ (b & 0xff), 0);
}

/** Escape reserved control bytes. Operates on body+checksum. */
export function substitute(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    const sub = SUBSTITUTE[b & 0xff];
    if (sub !== undefined) out.push(ESC, sub);
    else out.push(b & 0xff);
  }
  return out;
}

/** Reverse {@link substitute}. Throws on a malformed escape sequence. */
export function unsubstitute(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]! & 0xff;
    if (b === ESC) {
      const next = bytes[++i];
      if (next === undefined) throw new Error("dangling escape byte at end of frame");
      const orig = UNSUBSTITUTE[next & 0xff];
      if (orig === undefined) throw new Error(`invalid escape sequence 0x1B 0x${next.toString(16)}`);
      out.push(orig);
    } else {
      out.push(b);
    }
  }
  return out;
}

// ── value helpers ────────────────────────────────────────────

/** Encode a 32-bit signed integer as 4 big-endian bytes. */
export function encodeInt32(value: number): number[] {
  const v = value | 0; // coerce to int32
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/** Decode 4 big-endian bytes as a 32-bit signed integer. */
export function decodeInt32(bytes: readonly number[]): number {
  const v = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return v | 0; // reinterpret as signed
}

/** level 0..1 → percent-raw value (raw = percent × 65536, percent 0..100). */
export function levelToPercentRaw(level: number): number {
  return Math.round(clamp01(level) * 100 * 65536);
}

/** percent-raw value → level 0..1. */
export function percentRawToLevel(raw: number): number {
  return clamp01(raw / 65536 / 100);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ── address encoding ─────────────────────────────────────────

function encodeAddress(addr: ParameterAddress): number[] {
  return [
    (addr.node >>> 8) & 0xff,
    addr.node & 0xff,
    addr.virtualDevice & 0xff,
    (addr.object >>> 16) & 0xff,
    (addr.object >>> 8) & 0xff,
    addr.object & 0xff,
    (addr.param >>> 8) & 0xff,
    addr.param & 0xff,
  ];
}

// ── message encoding ─────────────────────────────────────────

/** Build a complete framed message (with STX/ETX, checksum, substitution). */
export function encodeMessage(msg: DiMessage): Buffer {
  const body = [msg.type & 0xff, ...encodeAddress(msg), ...encodeInt32(msg.value)];
  return frameBody(body);
}

/**
 * Build a SUBSCRIBE / UNSUBSCRIBE / SET / SET_PERCENT etc. for one address.
 * `value` defaults to 0 (ignored by the device for subscribe/unsubscribe).
 */
export function encodeAddressMessage(
  type: number,
  addr: ParameterAddress,
  value = 0,
): Buffer {
  return encodeMessage({ type, value, ...addr });
}

/** Build a PARAMETER PRESET RECALL message (no addressing; value = preset id). */
export function encodePresetRecall(presetId: number): Buffer {
  const body = [MsgType.RECALL_PRESET, ...encodeInt32(presetId)];
  return frameBody(body);
}

/** Append the checksum, substitute, and wrap a raw body in STX/ETX. */
function frameBody(body: number[]): Buffer {
  const checksum = xorChecksum(body);
  const substituted = substitute([...body, checksum]);
  return Buffer.from([STX, ...substituted, ETX]);
}

// ── message decoding ─────────────────────────────────────────

/**
 * Decode one frame's inner bytes (everything between STX and ETX, still
 * substituted). Returns null for frames that are not address-carrying messages
 * (e.g. preset recall echoes) or that fail validation.
 *
 * Throws only on a structurally broken escape sequence; checksum mismatches and
 * unexpected lengths return null so a noisy link degrades gracefully.
 */
export function decodeFrame(inner: readonly number[]): DiMessage | null {
  const bytes = unsubstitute(inner);
  if (bytes.length < 2) return null;

  const checksum = bytes[bytes.length - 1]!;
  const body = bytes.slice(0, -1);
  if (xorChecksum(body) !== checksum) return null;

  // type(1) + node(2) + vd(1) + object(3) + param(2) + value(4) = 13 bytes
  if (body.length !== 13) return null;

  return {
    type: body[0]!,
    node: (body[1]! << 8) | body[2]!,
    virtualDevice: body[3]!,
    object: (body[4]! << 16) | (body[5]! << 8) | body[6]!,
    param: (body[7]! << 8) | body[8]!,
    value: decodeInt32(body.slice(9, 13)),
  };
}

/**
 * Incremental frame decoder for a TCP byte stream.
 *
 * Reserved bytes never appear inside the body (they're escaped), so STX and ETX
 * are unambiguous frame markers. `push()` returns every complete inner-byte
 * frame found, buffering any partial trailing frame for the next chunk.
 */
export class FrameDecoder {
  private buf: number[] = [];
  private inFrame = false;

  /** Feed a chunk; returns zero or more complete inner-byte frames. */
  push(chunk: Uint8Array): number[][] {
    const frames: number[][] = [];
    for (const byte of chunk) {
      if (byte === STX) {
        this.inFrame = true;
        this.buf = [];
      } else if (byte === ETX) {
        if (this.inFrame) {
          frames.push(this.buf);
          this.buf = [];
          this.inFrame = false;
        }
      } else if (this.inFrame) {
        this.buf.push(byte);
      }
      // bytes outside a frame (before the first STX) are ignored
    }
    return frames;
  }

  reset(): void {
    this.buf = [];
    this.inFrame = false;
  }
}
