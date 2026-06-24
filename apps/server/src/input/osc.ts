/**
 * Pure OSC 1.0 packet decoder — turns a UDP datagram into the `{ address, args }`
 * messages it carries. No socket, no dependencies; kept separate from
 * {@link OscServer} so it is exhaustively unit-testable.
 *
 * Wire format (OSC 1.0, big-endian, everything 4-byte aligned):
 *   - OSC-string: ASCII bytes, a null terminator, then null padding up to the
 *     next multiple of 4.
 *   - OSC-blob:   int32 byte count, the bytes, then padding to a multiple of 4.
 *   - A *message* = address (OSC-string starting "/") + type-tag string
 *     (OSC-string starting ",") + one argument per tag.
 *   - A *bundle*  = "#bundle" + 8-byte time-tag + a sequence of
 *     (int32 size, element) where each element is itself a message or bundle.
 *     We unwrap bundles and ignore the time-tag (ingress fires immediately).
 *
 * Supported type tags: i f s S b h t d T F N I c r m. `h`/`t` (64-bit) are
 * narrowed to `number` so values flow cleanly into JSON params; blobs surface as
 * `Uint8Array`. An unknown tag throws {@link OscParseError} and the whole
 * datagram is dropped by the server.
 */

/** Thrown on a malformed OSC packet; the server logs + drops the datagram. */
export class OscParseError extends Error {}

/** A decoded OSC message: its address pattern and positional arguments. */
export interface OscMessage {
  address: string;
  args: unknown[];
}

/** Big-endian, alignment-aware cursor over a datagram. */
class Reader {
  private readonly view: DataView;
  pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  /** Advance to the next 4-byte boundary (fields are aligned from the start). */
  private align(): void {
    this.pos = (this.pos + 3) & ~3;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new OscParseError("unexpected end of OSC packet");
  }

  readInt32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readUint32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readFloat32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, false);
    this.pos += 4;
    return v;
  }

  readFloat64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, false);
    this.pos += 8;
    return v;
  }

  readBigInt64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.pos, false);
    this.pos += 8;
    return v;
  }

  readString(): string {
    let end = this.pos;
    while (end < this.buf.length && this.buf[end] !== 0) end++;
    if (end >= this.buf.length) throw new OscParseError("unterminated OSC string");
    const s = new TextDecoder().decode(this.buf.subarray(this.pos, end));
    this.pos = end + 1; // step over the null terminator
    this.align();
    return s;
  }

  readBlob(): Uint8Array {
    const len = this.readInt32();
    if (len < 0) throw new OscParseError("negative blob length");
    this.need(len);
    const b = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    this.align();
    return b;
  }

  /** Consume `len` bytes and return them as a sub-view (for bundle elements). */
  readSlice(len: number): Uint8Array {
    if (len < 0) throw new OscParseError("negative element size");
    this.need(len);
    const view = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return view;
  }
}

/** Decode a single OSC message body (cursor positioned at its address). */
function decodeMessage(r: Reader): OscMessage {
  const address = r.readString();
  if (!address.startsWith("/")) throw new OscParseError(`invalid OSC address: "${address}"`);

  const args: unknown[] = [];
  // The type-tag string is technically optional; a message without one has no args.
  if (r.remaining > 0) {
    const tags = r.readString();
    if (tags.startsWith(",")) {
      for (const tag of tags.slice(1)) args.push(readArg(r, tag));
    }
  }
  return { address, args };
}

/** Read one argument for the given type tag. */
function readArg(r: Reader, tag: string): unknown {
  switch (tag) {
    case "i":
      return r.readInt32();
    case "r": // RGBA color (4 bytes)
    case "m": // MIDI message (4 bytes)
      return r.readUint32();
    case "f":
      return r.readFloat32();
    case "d":
      return r.readFloat64();
    case "s":
    case "S":
      return r.readString();
    case "b":
      return r.readBlob();
    case "h": // int64
    case "t": // OSC time-tag — surface as a number for JSON-friendliness
      return Number(r.readBigInt64());
    case "c":
      return String.fromCodePoint(r.readInt32());
    case "T":
      return true;
    case "F":
      return false;
    case "N":
      return null;
    case "I":
      return Number.POSITIVE_INFINITY;
    default:
      throw new OscParseError(`unsupported OSC type tag: "${tag}"`);
  }
}

/** Decode a bundle, appending each contained message to `out`. */
function decodeBundle(r: Reader, out: OscMessage[]): void {
  r.readString(); // "#bundle"
  r.readBigInt64(); // time-tag — ignored (fire immediately)
  while (r.remaining >= 4) {
    const size = r.readInt32();
    if (size % 4 !== 0) throw new OscParseError("bundle element size must be a multiple of 4");
    decodeInto(r.readSlice(size), out);
  }
}

/** Decode whichever packet `buf` is (message or bundle) into `out`. */
function decodeInto(buf: Uint8Array, out: OscMessage[]): void {
  if (buf.length === 0) return;
  const r = new Reader(buf);
  if (buf[0] === 0x23) decodeBundle(r, out); // '#'
  else if (buf[0] === 0x2f) out.push(decodeMessage(r)); // '/'
  else throw new OscParseError('not an OSC packet (must start with "/" or "#bundle")');
}

/**
 * Decode an OSC UDP datagram into its messages (a lone message → one entry; a
 * bundle → one per contained message, recursively).
 *
 * @throws {OscParseError} if the bytes are not a well-formed OSC packet.
 */
export function decodeOscPacket(datagram: Uint8Array): OscMessage[] {
  const out: OscMessage[] = [];
  decodeInto(datagram, out);
  return out;
}
