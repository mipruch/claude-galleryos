/**
 * Pure Samsung MDC (Multiple Display Control) binary codec.
 *
 * Wire format, per the Samsung MDC Protocol specification (cross-checked
 * against the public "MDC Protocol 2015 v13.7c" reference and the
 * `vgavro/samsung-mdc` implementation of the same spec):
 *
 *   Command:  0xAA │ cmd(1) │ displayId(1) │ len(1) │ data[len] │ checksum(1)
 *   Response: 0xAA │ 0xFF   │ displayId(1) │ len(1) │ ack(1) │ cmd(1) │ data[len-2] │ checksum(1)
 *
 *   checksum = (secondByte + displayId + len + sum(data)) & 0xFF
 *              — the header byte (0xAA) itself is excluded.
 *   ack byte: 0x41 ('A') = ACK, 0x4E ('N') = NAK. On NAK the byte(s) after the
 *   echoed command are a device error code instead of the command's reply data.
 *
 * A zero-length data command is a "get" (query current value); one data byte
 * is a "set". Only Power Control (0x11) is implemented here — this driver's
 * only required capability is turning displays on/off (+ reading power back).
 */

export const MDC_HEADER = 0xaa;
export const RESPONSE_MARKER = 0xff;
export const ACK = 0x41;
export const NAK = 0x4e;

export const POWER_COMMAND = 0x11;

/** Power Control data values (also used for the `SET` command's single data byte). */
export const PowerState = {
  OFF: 0x00,
  ON: 0x01,
  REBOOT: 0x02,
} as const;

function checksum(bytes: readonly number[]): number {
  return bytes.reduce((sum, b) => sum + (b & 0xff), 0) & 0xff;
}

/** Build one command frame: header + cmd + displayId + len + data + checksum. */
function encodeCommand(command: number, displayId: number, data: readonly number[] = []): Buffer {
  const body = [command & 0xff, displayId & 0xff, data.length, ...data];
  return Buffer.from([MDC_HEADER, ...body, checksum(body)]);
}

/** Query current power state (zero-length data = "get"). */
export function encodePowerQuery(displayId: number): Buffer {
  return encodeCommand(POWER_COMMAND, displayId, []);
}

/** Set power state (on/off/reboot). */
export function encodePowerSet(displayId: number, state: number): Buffer {
  return encodeCommand(POWER_COMMAND, displayId, [state]);
}

/** One fully decoded response frame. */
export interface MdcResponse {
  ack: boolean;
  displayId: number;
  /** The command this response answers (echoed back by the display). */
  command: number;
  /** Reply payload on ACK (e.g. `[powerState]`); the error code on NAK. */
  data: number[];
}

/**
 * Decode one complete frame's bytes (header through checksum inclusive).
 * Returns null on a structural mismatch (wrong header/marker, bad length, bad
 * checksum) so a noisy link degrades gracefully instead of throwing.
 */
export function decodeResponse(frame: readonly number[]): MdcResponse | null {
  if (frame.length < 6) return null;
  if (frame[0] !== MDC_HEADER || frame[1] !== RESPONSE_MARKER) return null;

  const displayId = frame[2]!;
  const len = frame[3]!;
  if (frame.length !== 4 + len + 1) return null;

  const data = frame.slice(4, 4 + len);
  const receivedChecksum = frame[frame.length - 1]!;
  const body = [RESPONSE_MARKER, displayId, len, ...data];
  if (checksum(body) !== receivedChecksum) return null;

  const ackByte = data[0];
  const command = data[1];
  if (ackByte === undefined || command === undefined) return null;
  if (ackByte !== ACK && ackByte !== NAK) return null;

  return { ack: ackByte === ACK, displayId, command, data: data.slice(2) };
}

/**
 * Incremental frame decoder for a Samsung MDC byte stream. Response frames are
 * length-prefixed (no delimiter), so a byte that doesn't start a valid frame
 * is dropped and the decoder resyncs on the next 0xAA.
 */
export class MdcFrameDecoder {
  private buf: number[] = [];

  /** Feed a chunk; returns zero or more complete, checksum-valid responses. */
  push(chunk: Uint8Array): MdcResponse[] {
    for (const byte of chunk) this.buf.push(byte);
    const frames: MdcResponse[] = [];

    while (this.buf.length > 0) {
      if (this.buf[0] !== MDC_HEADER) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < 2) break; // need the marker byte
      if (this.buf[1] !== RESPONSE_MARKER) {
        this.buf.shift(); // not a response frame; resync
        continue;
      }
      if (this.buf.length < 4) break; // need displayId + len to know the frame size

      const len = this.buf[3]!;
      const total = 4 + len + 1;
      if (this.buf.length < total) break; // wait for the rest of the frame

      const frame = this.buf.slice(0, total);
      this.buf = this.buf.slice(total);
      const decoded = decodeResponse(frame);
      // A frame that fails to decode (bad checksum) is dropped silently; the
      // loop keeps resyncing from whatever bytes remain.
      if (decoded) frames.push(decoded);
    }
    return frames;
  }

  reset(): void {
    this.buf = [];
  }
}

/** Map a power query/set reply's data byte to a friendly state string. */
export function decodePowerState(data: readonly number[]): "on" | "off" | "unknown" {
  switch (data[0]) {
    case PowerState.OFF: return "off";
    case PowerState.ON: return "on";
    default: return "unknown";
  }
}
