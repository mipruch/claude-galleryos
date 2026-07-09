/**
 * Minimal OSC 1.0 message *encoder* + a text-argument parser, shared by any
 * driver that sends OSC (e.g. driver-generic-trigger). This is the outbound
 * mirror of the OSC *decoder* the core's OSC input listener uses
 * (`apps/server/src/input/osc.ts`) — decoding is a server-side input concern
 * (turning inbound datagrams into scene triggers), so it stays there; encoding
 * is a driver concern (turning a configured message into outbound bytes), so
 * it lives here where every driver package can reach it.
 *
 * Wire format (OSC 1.0, big-endian, everything 4-byte aligned) — see
 * `apps/server/src/input/osc.ts`'s doc comment for the full spec recap.
 */

/** A typed OSC argument for {@link encodeOscMessage}. */
export type OscArg =
  | { tag: "i" | "f"; value: number }
  | { tag: "s"; value: string }
  | { tag: "b"; value: Uint8Array }
  | { tag: "T" | "F" | "N" | "I" };

const padTo4 = (len: number): number => (len + 3) & ~3;

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Encode an OSC-string: bytes + null terminator, padded to a multiple of 4. */
export function oscString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const out = new Uint8Array(padTo4(bytes.length + 1)); // +1 for the null terminator
  out.set(bytes);
  return out;
}

function int32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setInt32(0, value, false);
  return buf;
}

function float32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setFloat32(0, value, false);
  return buf;
}

/** Build one OSC message datagram: address pattern + type tags + argument bytes. */
export function encodeOscMessage(address: string, args: OscArg[] = []): Uint8Array {
  const tags = `,${args.map((a) => a.tag).join("")}`;
  const chunks: Uint8Array[] = [oscString(address), oscString(tags)];
  for (const arg of args) {
    if (arg.tag === "i") chunks.push(int32(arg.value));
    else if (arg.tag === "f") chunks.push(float32(arg.value));
    else if (arg.tag === "s") chunks.push(oscString(arg.value));
    else if (arg.tag === "b") {
      chunks.push(int32(arg.value.length), arg.value, new Uint8Array(padTo4(arg.value.length) - arg.value.length));
    }
    // T/F/N/I carry no argument bytes — the type tag alone conveys the value.
  }
  return concat(chunks);
}

/** Wrap already-encoded elements (messages/bundles) in an OSC bundle (immediate time-tag). */
export function encodeOscBundle(elements: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [oscString("#bundle"), new Uint8Array(8) /* zero time-tag */];
  for (const element of elements) chunks.push(int32(element.length), element);
  return concat(chunks);
}

const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?(\d+\.\d*|\.\d+)$/;

function parseOscArg(token: string): OscArg {
  if (INT_RE.test(token)) return { tag: "i", value: parseInt(token, 10) };
  if (FLOAT_RE.test(token)) return { tag: "f", value: parseFloat(token) };
  if (/^true$/i.test(token)) return { tag: "T" };
  if (/^false$/i.test(token)) return { tag: "F" };
  return { tag: "s", value: token };
}

/**
 * Parse a free-text, whitespace-separated argument list into typed OSC args,
 * inferring one type per token: digits-only (optionally signed) → int32,
 * anything with a decimal point → float32, `true`/`false` → OSC bool,
 * everything else → string, verbatim. Lets an admin type OSC arguments as
 * plain text (e.g. `"1 0.5 hello"`) instead of building a structured argument
 * editor — see driver-generic-trigger. Blank input yields no arguments.
 */
export function parseOscArgs(text: string | undefined | null): OscArg[] {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/).map(parseOscArg);
}
