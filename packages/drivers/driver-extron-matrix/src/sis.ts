/**
 * Pure Extron SIS (Simple Instruction Set) helpers for matrix switchers.
 *
 * SIS is the ASCII control protocol spoken by Extron matrix switchers — the
 * DTP CrossPoint 108 4K (10 inputs × 8 outputs), CrossPoint, MAV Plus, … — over
 * TCP 23 (Telnet). Commands are CR-terminated; the device answers with
 * CR/LF-framed lines. This module owns *only* the wire grammar (building command
 * strings and parsing response lines); the driver owns the socket lifecycle.
 *
 * ⚠️ The exact response wording can vary slightly between firmware revisions
 * (e.g. `In05` vs a bare `05`, `Vid`/`Aud`/`All` casing). `parseResponseLine`
 * is therefore deliberately tolerant — see each branch. Confirm against the
 * device's SIS manual / a live unit before relying on a specific shape.
 *
 * Switch (tie) grammar:
 *   {in}*{out}!   tie input→output, Audio **and** Video together ("All")
 *   {in}*{out}%   tie input→output, Video only
 *   {in}*{out}$   tie input→output, Audio only
 *   input 0 unties the output (no source — blank/black).
 *
 * Read (query) grammar — same symbol, but with no `{in}*` prefix:
 *   {out}!        view the AV/All input tied to an output
 *   {out}%        view the Video input tied to an output
 *   {out}$        view the Audio input tied to an output
 *
 * Tie responses are self-describing (`Out02 In05 All`); query responses echo
 * just the input number (`In05` or `05`).
 */

/** The three signal planes an Extron tie can address. */
export type TieType = "av" | "video" | "audio";

/** SIS operator symbol per tie type. */
const TIE_SYMBOL: Record<TieType, string> = {
  av: "!",
  video: "%",
  audio: "$",
};

/** Map the verbose tie-type token in a response back to our {@link TieType}. */
const RESPONSE_TIE_TYPE: Record<string, TieType> = {
  all: "av",
  rgb: "video", // RGB/video plane — treat as video for state purposes
  vid: "video",
  aud: "audio",
};

/**
 * Human-readable messages for the SIS error codes, per the DTP CrossPoint 4K
 * Series Programming Guide ("Switcher Error Responses").
 */
const SIS_ERRORS: Record<string, string> = {
  E01: "invalid input number (out of range)",
  E10: "invalid command",
  E11: "invalid preset number (out of range)",
  E12: "invalid output number (out of range)",
  E13: "invalid value (out of range)",
  E14: "invalid command for this configuration",
  E22: "busy",
  E24: "privilege violation",
  E25: "device not present",
  E26: "maximum number of connections exceeded",
  E28: "bad filename or file not found",
  E33: "bad file type or size",
};

/**
 * Build a tie (switch) command. `input` 0 unties the output. Caller is
 * responsible for range-checking against the matrix size.
 */
export function buildTieCommand(input: number, output: number, type: TieType): string {
  return `${input}*${output}${TIE_SYMBOL[type]}`;
}

/** Build a query for the input currently tied to `output` on the given plane. */
export function buildQueryCommand(output: number, type: TieType): string {
  return `${output}${TIE_SYMBOL[type]}`;
}

// ── response parsing ─────────────────────────────────────────

/** A confirmed/echoed tie: `Out02 In05 All`. */
export interface TieResponse {
  kind: "tie";
  output: number;
  input: number;
  type: TieType;
}

/** A bare input number returned by a query: `In05` or `05`. */
export interface NumberResponse {
  kind: "number";
  value: number;
}

/** A protocol error: `E13`. */
export interface ErrorResponse {
  kind: "error";
  code: string;
  message: string;
}

/** Anything we recognise but don't act on (banner, password prompt, login, …). */
export interface InfoResponse {
  kind: "info";
  /** A coarse tag so the driver can react (e.g. answer a password prompt). */
  tag: "password" | "login" | "banner" | "other";
  raw: string;
}

export type ParsedResponse = TieResponse | NumberResponse | ErrorResponse | InfoResponse;

const TIE_RE = /^Out0*(\d+)\s+In0*(\d+)\s+(All|Vid|Aud|RGB)\b/i;
const NUMBER_RE = /^(?:In)?0*(\d+)$/i;
const ERROR_RE = /^E0*(\d+)$/i;

/**
 * Parse one response line from the device. Tolerant by design (see file header):
 * trims surrounding whitespace and accepts zero-padded numbers / mixed casing.
 */
export function parseResponseLine(line: string): ParsedResponse {
  const trimmed = line.trim();

  const tie = TIE_RE.exec(trimmed);
  if (tie) {
    return {
      kind: "tie",
      output: Number(tie[1]),
      input: Number(tie[2]),
      type: RESPONSE_TIE_TYPE[tie[3]!.toLowerCase()] ?? "av",
    };
  }

  const err = ERROR_RE.exec(trimmed);
  if (err) {
    const code = `E${err[1]!.padStart(2, "0")}`;
    return { kind: "error", code, message: SIS_ERRORS[code] ?? "unknown error" };
  }

  const num = NUMBER_RE.exec(trimmed);
  if (num) return { kind: "number", value: Number(num[1]) };

  // Non-data lines: the connect banner, an auth prompt, or a login confirmation.
  if (/password/i.test(trimmed)) return { kind: "info", tag: "password", raw: trimmed };
  if (/^login/i.test(trimmed)) return { kind: "info", tag: "login", raw: trimmed };
  if (/copyright|extron/i.test(trimmed)) return { kind: "info", tag: "banner", raw: trimmed };
  return { kind: "info", tag: "other", raw: trimmed };
}
