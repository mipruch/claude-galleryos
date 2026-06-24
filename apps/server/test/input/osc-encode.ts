/**
 * Minimal OSC 1.0 *encoder* — test support only, the mirror of the production
 * `src/input/osc.ts` decoder. Lets the OSC tests build real wire bytes (and round
 * trip them through a UDP socket) instead of hand-rolling byte arrays.
 *
 * Supports the tags the tests use: i (int32), f (float32), s (string), b (blob),
 * T/F/N/I (no-arg). Big-endian, 4-byte aligned, exactly like the spec.
 */

/** A typed OSC argument for {@link encodeOscMessage}. */
export type OscArg =
  | { tag: "i" | "f"; value: number }
  | { tag: "s"; value: string }
  | { tag: "b"; value: Uint8Array }
  | { tag: "T" | "F" | "N" | "I" };

const padTo4 = (len: number): number => (len + 3) & ~3;

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
};

/** Encode an OSC-string: bytes + null, padded with nulls to a multiple of 4. */
export function oscString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(padTo4(bytes.length + 1)); // +1 for the null terminator
  out.set(bytes);
  return out;
}

const int32 = (value: number): Uint8Array => {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setInt32(0, value, false);
  return buf;
};

const float32 = (value: number): Uint8Array => {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setFloat32(0, value, false);
  return buf;
};

/** Build an OSC message datagram. */
export function encodeOscMessage(address: string, args: OscArg[] = []): Uint8Array {
  const tags = `,${args.map((a) => a.tag).join("")}`;
  const chunks: Uint8Array[] = [oscString(address), oscString(tags)];
  for (const a of args) {
    if (a.tag === "i") chunks.push(int32(a.value));
    else if (a.tag === "f") chunks.push(float32(a.value));
    else if (a.tag === "s") chunks.push(oscString(a.value));
    else if (a.tag === "b") {
      chunks.push(int32(a.value.length), a.value, new Uint8Array(padTo4(a.value.length) - a.value.length));
    }
    // T/F/N/I carry no bytes.
  }
  return concat(chunks);
}

/** Wrap already-encoded elements (messages/bundles) in an OSC bundle. */
export function encodeOscBundle(elements: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [oscString("#bundle"), new Uint8Array(8) /* zero time-tag */];
  for (const el of elements) chunks.push(int32(el.length), el);
  return concat(chunks);
}
