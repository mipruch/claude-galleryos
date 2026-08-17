/**
 * Pure Iiyama ProLite RS232-over-LAN binary codec + Wake-on-LAN magic packet
 * builder.
 *
 * Wire format, per the manufacturer's "RS232 Serial Interface Communication
 * Protocol" application note (bundled at `manuals/`, applicable to the LHxx54
 * ProLite range, verified against the T6529AS):
 *
 *   Command : 0xA6 │ monitorId(1) │ 0x00 │ 0x00 │ 0x00 │ length(1) │ 0x01 │ data[N] │ checksum(1)
 *   Report  : 0x21 │ monitorId(1) │ 0x00 │ 0x00 │ length(1) │ 0x01 │ data[N] │ checksum(1)
 *
 * `length` = 2 + N (the data-control byte and the checksum byte, plus N data
 * bytes) — cross-checked against every worked example in the manual (e.g. the
 * documented "Power off" frame `A6 01 00 00 00 04 01 18 01 BB` has N=2 data
 * bytes `[0x18, 0x01]`, so length = 2+2 = 0x04).
 *
 * `checksum` = XOR of every byte in the frame except the checksum itself.
 *
 * The "function code" that would normally be a fixed protocol field (Code1)
 * is, on this device, folded into `data[0]` instead (Code1 itself is always
 * 0x00) — this file follows the concrete byte sequences from the manual
 * rather than its prose field table, which the worked examples don't match
 * literally.
 *
 * Only Power state Get/Set (function bytes 0x19/0x18) and the generic
 * Communication Control acknowledgement (function byte 0x00, sent by the
 * display after it completes a Set command) are implemented — this driver's
 * only required capability is turning the display on/off and reading power
 * state back for the watchdog.
 */

export const COMMAND_HEADER = 0xa6;
export const REPORT_HEADER = 0x21;
const DATA_CONTROL = 0x01;

/** Function bytes (carried as `data[0]`). */
export const FUNC_POWER_SET = 0x18;
export const FUNC_POWER_GET = 0x19;
/** Data[0] value of the display's own "command completed" report. */
export const FUNC_COMM_CONTROL = 0x00;

export const PowerState = { OFF: 0x01, ON: 0x02 } as const;
/** Communication Control status byte (data[1] of a Comm Control report). */
export const CommStatus = { COMPLETED: 0x00 } as const;

function xor(bytes: readonly number[]): number {
  return bytes.reduce((acc, b) => acc ^ (b & 0xff), 0);
}

function encodeCommand(monitorId: number, data: readonly number[]): Buffer {
  const length = data.length + 2; // data control (1) + data (N) + checksum (1)
  const body = [COMMAND_HEADER, monitorId & 0xff, 0x00, 0x00, 0x00, length, DATA_CONTROL, ...data];
  return Buffer.from([...body, xor(body)]);
}

/** Set Power state = Off (function 0x18, data[1] = 0x01). */
export function encodePowerOff(monitorId: number): Buffer {
  return encodeCommand(monitorId, [FUNC_POWER_SET, PowerState.OFF]);
}

/** Get current power state (function 0x19, no parameter). */
export function encodePowerGet(monitorId: number): Buffer {
  return encodeCommand(monitorId, [FUNC_POWER_GET]);
}

/** One decoded report frame from the display. */
export interface IiyamaReport {
  monitorId: number;
  /** `[functionOrCommandByte, ...payload]`, i.e. everything after Data Control. */
  data: number[];
}

/**
 * Decode one complete frame's bytes (header through checksum inclusive).
 * Returns null on a structural mismatch (wrong header, bad length, missing/
 * wrong data-control byte, bad checksum) so a noisy link degrades gracefully.
 */
function decodeReport(frame: readonly number[]): IiyamaReport | null {
  if (frame.length < 7) return null;
  if (frame[0] !== REPORT_HEADER) return null;

  const monitorId = frame[1]!;
  const length = frame[4]!;
  if (length < 2 || frame.length !== 5 + length) return null;

  const dataControl = frame[5]!;
  if (dataControl !== DATA_CONTROL) return null;

  const data = frame.slice(6, 5 + length - 1);
  const receivedChecksum = frame[frame.length - 1]!;
  const body = frame.slice(0, frame.length - 1);
  if (xor(body) !== receivedChecksum) return null;

  return { monitorId, data };
}

/**
 * Incremental frame decoder for an Iiyama report byte stream. Frames are
 * length-prefixed (no delimiter); a byte that doesn't start a valid frame is
 * dropped and the decoder resyncs on the next 0x21.
 */
export class IiyamaFrameDecoder {
  private buf: number[] = [];

  /** Feed a chunk; returns zero or more complete, checksum-valid reports. */
  push(chunk: Uint8Array): IiyamaReport[] {
    for (const byte of chunk) this.buf.push(byte);
    const frames: IiyamaReport[] = [];

    while (this.buf.length > 0) {
      if (this.buf[0] !== REPORT_HEADER) {
        this.buf.shift();
        continue;
      }
      if (this.buf.length < 5) break; // need the length byte
      const length = this.buf[4]!;
      const total = 5 + length;
      if (this.buf.length < total) break; // wait for the rest of the frame

      const frame = this.buf.slice(0, total);
      this.buf = this.buf.slice(total);
      const decoded = decodeReport(frame);
      if (decoded) frames.push(decoded);
    }
    return frames;
  }
}

/** True if `report` is a Power state report (function 0x19). */
export function isPowerReport(report: IiyamaReport): boolean {
  return report.data[0] === FUNC_POWER_GET;
}

/** Map a Power state report's payload to a friendly state string. */
export function decodePowerState(data: readonly number[]): "on" | "off" | "unknown" {
  switch (data[1]) {
    case PowerState.OFF:
      return "off";
    case PowerState.ON:
      return "on";
    default:
      return "unknown";
  }
}

/** True if `report` is the generic Communication Control acknowledgement. */
export function isCommConfirmation(report: IiyamaReport): boolean {
  return report.data[0] === FUNC_COMM_CONTROL;
}

/** True if `report` is a Communication Control ack reporting success. */
export function isCommCompleted(report: IiyamaReport): boolean {
  return isCommConfirmation(report) && report.data[1] === CommStatus.COMPLETED;
}

// ── Wake-on-LAN ──────────────────────────────────────────────

/** Build a standard Wake-on-LAN magic packet: 6× 0xFF, then the MAC repeated 16×. */
export function buildMagicPacket(macAddress: string): Buffer {
  const macBytes = parseMacAddress(macAddress);
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) macBytes.copy(packet, 6 + i * 6);
  return packet;
}

function parseMacAddress(macAddress: string): Buffer {
  const hex = macAddress.replace(/[:-]/g, "");
  if (!/^[0-9A-Fa-f]{12}$/.test(hex)) {
    throw new Error(`invalid MAC address: ${macAddress}`);
  }
  return Buffer.from(hex, "hex");
}
