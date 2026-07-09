/**
 * Pure unit tests for the OSC 1.0 encoder + text-argument parser.
 *
 * Byte-level correctness of encodeOscMessage is additionally exercised by
 * round-tripping through the OSC *decoder* in apps/server/src/input/osc.ts's
 * test suite (which imports this same encoder) — kept here too so driver-core
 * has standalone coverage without depending on the server package.
 */
import { describe, expect, test } from "bun:test";
import { encodeOscBundle, encodeOscMessage, oscString, parseOscArgs } from "../src/osc.ts";

describe("oscString", () => {
  test("pads to a 4-byte boundary with a null terminator", () => {
    expect(oscString("/go")).toEqual(new Uint8Array([0x2f, 0x67, 0x6f, 0x00])); // "/go\0" — already 4 bytes
    expect(oscString("/x")).toEqual(new Uint8Array([0x2f, 0x78, 0x00, 0x00])); // "/x\0" + 1 pad byte
  });
});

describe("encodeOscMessage", () => {
  test("a zero-argument message is just the address + an empty type-tag string", () => {
    const msg = encodeOscMessage("/go");
    expect(msg).toEqual(concat(oscString("/go"), oscString(",")));
  });

  test("encodes int/float/string arguments with the right tags and byte widths", () => {
    const msg = encodeOscMessage("/cue/1/level", [
      { tag: "i", value: 3 },
      { tag: "f", value: 0.5 },
      { tag: "s", value: "hi" },
    ]);
    const expected = concat(
      oscString("/cue/1/level"),
      oscString(",ifs"),
      int32(3),
      float32(0.5),
      oscString("hi"),
    );
    expect(msg).toEqual(expected);
  });

  test("boolean tags (T/F) carry no argument bytes", () => {
    const msg = encodeOscMessage("/mute", [{ tag: "T" }]);
    expect(msg).toEqual(concat(oscString("/mute"), oscString(",T")));
  });
});

describe("encodeOscBundle", () => {
  test("wraps elements with #bundle + zero time-tag + size-prefixed elements", () => {
    const element = encodeOscMessage("/go");
    const bundle = encodeOscBundle([element]);
    expect(bundle).toEqual(concat(oscString("#bundle"), new Uint8Array(8), int32(element.length), element));
  });
});

describe("parseOscArgs", () => {
  test("blank input yields no arguments", () => {
    expect(parseOscArgs(undefined)).toEqual([]);
    expect(parseOscArgs(null)).toEqual([]);
    expect(parseOscArgs("")).toEqual([]);
    expect(parseOscArgs("   ")).toEqual([]);
  });

  test("infers int, float, bool, and string per whitespace-separated token", () => {
    expect(parseOscArgs("1 -2 0.5 -1.5 .25 true FALSE hello")).toEqual([
      { tag: "i", value: 1 },
      { tag: "i", value: -2 },
      { tag: "f", value: 0.5 },
      { tag: "f", value: -1.5 },
      { tag: "f", value: 0.25 },
      { tag: "T" },
      { tag: "F" },
      { tag: "s", value: "hello" },
    ]);
  });

  test("collapses repeated whitespace and trims", () => {
    expect(parseOscArgs("  1   2  ")).toEqual([
      { tag: "i", value: 1 },
      { tag: "i", value: 2 },
    ]);
  });

  test("a single numeric argument round-trips through encodeOscMessage", () => {
    const args = parseOscArgs("0.8");
    const msg = encodeOscMessage("/cue/1/level", args);
    expect(msg).toEqual(concat(oscString("/cue/1/level"), oscString(",f"), float32(0.8)));
  });
});

// ── local byte helpers (mirroring the OSC 1.0 wire format for assertions) ──

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

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
