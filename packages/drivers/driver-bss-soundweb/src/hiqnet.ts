// Minimal HiQnet (DI/Soundweb London) packetisation helpers.
// MVP-grade: forms a SET / SUBSCRIBE binary frame with DLE escape and checksum
// per the public BSS SoundWeb DI protocol. Not a full HiQnet stack.

const STX = 0x02;
const ETX = 0x03;
const ACK = 0x06;
const NAK = 0x15;
const DLE = 0x10;

const SPECIAL = new Set([STX, ETX, ACK, NAK, DLE]);

const MSG_SET_PARAM = 0x88;
const MSG_SUBSCRIBE = 0x89;
const MSG_UNSUBSCRIBE = 0x8a;
const MSG_RECALL_PRESET = 0x8c;
const MSG_SET_PARAM_PERCENT = 0x8d;

export interface BssAddress {
  nodeId: number;
  virtualDevice: number;
  object: number;
  parameter: number;
}

function escapeBytes(bytes: number[]): number[] {
  const out: number[] = [];
  for (const b of bytes) {
    if (SPECIAL.has(b)) out.push(DLE, b);
    else out.push(b);
  }
  return out;
}

function checksum(body: number[]): number {
  let sum = 0;
  for (const b of body) sum ^= b;
  return sum;
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u24(value: number): number[] {
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function s32(value: number): number[] {
  return [
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ];
}

function buildBody(messageId: number, addr: BssAddress, value: number): number[] {
  // Address: nodeId (16) | virtualDevice (8) | object (24) | parameter (16)
  return [
    messageId,
    ...u16(addr.nodeId),
    addr.virtualDevice & 0xff,
    ...u24(addr.object),
    ...u16(addr.parameter),
    ...s32(value),
  ];
}

function frame(body: number[]): Buffer {
  const cs = checksum(body);
  const escaped = escapeBytes([...body, cs]);
  return Buffer.from([STX, ...escaped, ETX]);
}

export function encodeSetParam(addr: BssAddress, rawValue: number): Buffer {
  return frame(buildBody(MSG_SET_PARAM, addr, rawValue));
}

export function encodeSetParamPercent(addr: BssAddress, percent: number): Buffer {
  // Percent format: 0..100 mapped to 0..0x10000 in BSS docs (1% = 0x10000/100)
  const raw = Math.round((percent / 100) * 0x10000);
  return frame(buildBody(MSG_SET_PARAM_PERCENT, addr, raw));
}

export function encodeSubscribe(addr: BssAddress): Buffer {
  return frame(buildBody(MSG_SUBSCRIBE, addr, 0));
}

export function encodeUnsubscribe(addr: BssAddress): Buffer {
  return frame(buildBody(MSG_UNSUBSCRIBE, addr, 0));
}

export function encodeRecallPreset(presetId: number): Buffer {
  const body = [MSG_RECALL_PRESET, ...u24(presetId)];
  return frame(body);
}

// Map normalised 0..1 fader to BSS raw dB integer.
// BSS uses 1/10000 dB units. -80 dB ≈ -800000, 0 dB = 0, +10 dB = 100000.
export function levelToRaw(level: number): number {
  const clamped = Math.max(0, Math.min(1, level));
  if (clamped === 0) return -880000; // -88 dB ≈ -inf
  // Simple log mapping: 0..1 → -80..0 dB
  const db = -80 + clamped * 80;
  return Math.round(db * 10000);
}

export function rawToLevel(raw: number): number {
  const db = raw / 10000;
  if (db <= -80) return 0;
  return Math.max(0, Math.min(1, (db + 80) / 80));
}
