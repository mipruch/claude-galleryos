/**
 * Foxtron DALI ASCII protocol codec — pure, no I/O, fully unit-testable.
 *
 * Protocol reference: "Komunikační protokol verze 1.10" — DALI232, DALI232e,
 * DALInet, DALI2net (foxtron.cz)
 *
 * Frame format:
 *   SOH (0x01) | hex-encoded( dataBytes + checksum ) | ETB (0x17)
 *
 * Every byte of the data part (including the checksum) is encoded as exactly
 * two upper-case ASCII hex characters before transmission. For example byte
 * 0x1B → "1B" → [0x31, 0x42].
 *
 * Checksum = (~sum(dataBytes)) & 0xFF
 * Example: data=[0x01,0x00,0x10,0xFF,0x10], sum=0x120, sum%0x100=0x20, ~0x20=0xDF
 *
 * Message types used by this driver:
 *   1  (0x01) — send DALI frame (fire-and-forget; confirmed by Type 3/4)
 *  11  (0x0B) — send DALI frame with originator tracking (confirmed by 13/14)
 *   3  (0x03) — spontaneous: DALI message received WITH reply (from any master)
 *   4  (0x04) — spontaneous: DALI message received WITHOUT reply (from any master)
 *  13  (0x0D) — our Type-11 DALI message received WITH reply
 *  14  (0x0E) — our Type-11 DALI message received WITHOUT reply
 *   5  (0x05) — spontaneous: bus event (power lost, buffer full, …)
 *   6  (0x06) — query converter config (e.g. item 3 = DALI bus power status)
 *   7  (0x07) — converter config response
 *
 * DALI addressing (standard DALI):
 *   DAPC (direct level) — address byte = addr * 2          (broadcast = 0xFE)
 *   Commands/queries   — address byte = addr * 2 + 1       (broadcast = 0xFF)
 *   Group DAPC         — group * 2 + 0x80                  (group cmd = +0x81)
 *
 * Standard DALI commands (second byte of the 16-bit DALI frame):
 *   0x00 Off
 *   0x05 Recall max level
 *   0x10–0x1F Recall scene 0–15
 *   0xA0 Query actual level
 * DAPC: first byte = addr*2, second = arc power level 0–254
 */


// ── framing constants ─────────────────────────────────────────
 const SOH = 0x01;
 const ETB = 0x17;

// ── message type codes ────────────────────────────────────────
export const MsgType = {
  SEND:             0x01,
  SEND_ORIG:        0x0B,
  RECV_WITH_REPLY:  0x03,
  RECV_NO_REPLY:    0x04,
  BUS_EVENT:        0x05,
  CONFIG_QUERY:     0x06,
  CONFIG_RESP:      0x07,
  ORIG_WITH_REPLY:  0x0D,
  ORIG_NO_REPLY:    0x0E,
} as const;

// ── DALI standard command codes ───────────────────────────────
export const DaliCmd = {
  OFF:            0x00,
  RECALL_MAX:     0x05,
  RECALL_SCENE_0: 0x10, // scene N → 0x10 + N
  QUERY_LEVEL:    0xA0,
} as const;

// ── checksum ──────────────────────────────────────────────────

/** Foxtron frame checksum: bitwise-NOT of sum modulo 0x100. (exported: used by tests) */
export function calcChecksum(dataBytes: readonly number[]): number {
  const sum = dataBytes.reduce((a, b) => a + b, 0);
  return (~sum) & 0xFF;
}

// ── encode ────────────────────────────────────────────────────

/** Build a complete wire frame from raw data bytes. */
export function encodeFrame(dataBytes: readonly number[]): Buffer {
  const checksum = calcChecksum(dataBytes);
  const all = [...dataBytes, checksum];
  // Each byte → 2 upper-case ASCII hex chars.
  const ascii = all.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join("");
  return Buffer.concat([Buffer.from([SOH]), Buffer.from(ascii, "ascii"), Buffer.from([ETB])]);
}

// ── decode ────────────────────────────────────────────────────

/** Decode the ASCII content between SOH and ETB. Returns data bytes (no checksum). */
export function decodeFrame(ascii: string): { data: number[]; valid: boolean } {
  if (ascii.length < 4 || ascii.length % 2 !== 0) return { data: [], valid: false };
  const bytes: number[] = [];
  for (let i = 0; i < ascii.length; i += 2) {
    const b = parseInt(ascii.slice(i, i + 2), 16);
    if (isNaN(b)) return { data: [], valid: false };
    bytes.push(b);
  }
  const data = bytes.slice(0, -1);
  const checksum = bytes[bytes.length - 1]!;
  return { data, valid: checksum === calcChecksum(data) };
}

// ── streaming decoder ─────────────────────────────────────────

/**
 * Incremental decoder for a TCP byte stream.
 * Frames are delimited by SOH (0x01) and ETB (0x17). Since the content between
 * them is only ASCII hex chars [0-9A-F] (0x30–0x46), SOH and ETB are unambiguous
 * markers and no escaping is needed.
 */
export class FrameDecoder {
  private buf = "";
  private inFrame = false;

  /** Feed a chunk; returns zero or more decoded data-byte arrays. */
  push(chunk: Uint8Array): number[][] {
    const results: number[][] = [];
    for (const byte of chunk) {
      if (byte === SOH) {
        this.inFrame = true;
        this.buf = "";
      } else if (byte === ETB) {
        if (this.inFrame) {
          const { data, valid } = decodeFrame(this.buf);
          if (valid) results.push(data);
          this.buf = "";
          this.inFrame = false;
        }
      } else if (this.inFrame) {
        this.buf += String.fromCharCode(byte);
      }
    }
    return results;
  }

}

// ── message builders ──────────────────────────────────────────

/**
 * Build a Type-1 "Send DALI" data array (fire-and-forget).
 * Confirmed by device with Type 3 (if DALI reply) or Type 4 (no reply).
 */
export function buildSendDali(daliBytes: readonly number[], priority = 0): number[] {
  return [MsgType.SEND, priority, daliBytes.length * 8, ...daliBytes];
}

/**
 * Build a Type-11 "Send DALI with originator" data array.
 * The device confirms with Type 13 (reply) or Type 14 (no reply) for THIS device's
 * commands — unlike Type 3/4 which cover ALL DALI activity.
 * Set `twice=true` to send the command twice (required for some DALI config commands).
 */
export function buildSendDaliOrig(
  daliBytes: readonly number[],
  priority = 0,
  twice = false,
): number[] {
  const flags = twice ? 0x01 : 0x00;
  return [MsgType.SEND_ORIG, priority, daliBytes.length * 8, ...daliBytes, flags];
}

/**
 * Build a Type-6 "Query converter config" data array.
 * item 3 = DALI bus power status (0=OK, 1=lost/short, 2=mains voltage, 3=bad source)
 */
export function buildConfigQuery(item: number): number[] {
  return [MsgType.CONFIG_QUERY, item];
}

// ── DALI addressing helpers ───────────────────────────────────

// exported: used by the target helpers below and by the test suite.
export const DaliAddr = {
  /** DAPC individual: addr*2 (direct level command). */
  unicastDapc: (addr: number): number => (addr & 0x3F) * 2,
  /** Standard command/query to individual address: addr*2+1. */
  unicastCmd: (addr: number): number => (addr & 0x3F) * 2 + 1,
  /** DAPC broadcast: all devices. */
  broadcastDapc: 0xFE,
  /** Command/query broadcast: all devices. */
  broadcastCmd: 0xFF,
  /** DAPC to group G: G*2+0x80. */
  groupDapc: (g: number): number => (g & 0x0F) * 2 + 0x80,
  /** Command/query to group G: G*2+0x81. */
  groupCmd: (g: number): number => (g & 0x0F) * 2 + 0x81,
};

/** Convert a 0..1 level to a DALI arc power control value 0..254. */
export function levelToDapc(level: number): number {
  const clamped = Math.max(0, Math.min(1, level));
  return Math.round(clamped * 254);
}

/** Convert a DALI arc power control value 0..254 to a 0..1 level. */
export function dapcToLevel(dapc: number): number {
  return dapc / 254;
}

// ── high-level addressing target ──────────────────────────────

/**
 * A DALI command target: a single short address (0–63), a group (0–15), or
 * broadcast (all devices on the bus).
 */
export type DaliTarget =
  | { mode: "address"; address: number }
  | { mode: "group"; group: number }
  | { mode: "broadcast" };

/** Address byte for a Direct Arc Power Control (level) frame to a target. */
export function targetDapcByte(target: DaliTarget): number {
  switch (target.mode) {
    case "address":   return DaliAddr.unicastDapc(target.address);
    case "group":     return DaliAddr.groupDapc(target.group);
    case "broadcast": return DaliAddr.broadcastDapc;
  }
}

/** Address byte for a standard command/query frame to a target. */
export function targetCmdByte(target: DaliTarget): number {
  switch (target.mode) {
    case "address":   return DaliAddr.unicastCmd(target.address);
    case "group":     return DaliAddr.groupCmd(target.group);
    case "broadcast": return DaliAddr.broadcastCmd;
  }
}

/** Stable cache key for a target (e.g. "a5", "g2", "bc"). */
export function targetKey(target: DaliTarget): string {
  switch (target.mode) {
    case "address":   return `a${target.address}`;
    case "group":     return `g${target.group}`;
    case "broadcast": return "bc";
  }
}

/** Human-readable label for logs/errors. */
export function targetLabel(target: DaliTarget): string {
  switch (target.mode) {
    case "address":   return `address ${target.address}`;
    case "group":     return `group ${target.group}`;
    case "broadcast": return "broadcast";
  }
}
