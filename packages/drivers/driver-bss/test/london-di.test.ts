/**
 * London DI codec unit tests — pure, no sockets.
 *
 * Validates the wire encoding against the known-good reference output from the
 * field-tested `manuals/bss.js` script, plus round-trips and edge cases.
 */

import { describe, expect, test } from "bun:test";
import {
  FrameDecoder,
  MsgType,
  decodeFrame,
  decodeInt32,
  encodeInt32,
  encodeMessage,
  levelToPercentRaw,
  percentRawToLevel,
  substitute,
  unsubstitute,
  xorChecksum,
} from "../src/london-di.ts";

const hex = (b: Buffer | number[]): string =>
  Array.from(b).map((n) => n.toString(16).padStart(2, "0")).join(" ");

describe("checksum & substitution", () => {
  test("xorChecksum matches the bss.js reference (0x00)", () => {
    const body = [0x88, 0x1d, 0xfe, 0x03, 0x00, 0x01, 0x09, 0x00, 0x60, 0xff, 0xff, 0xff, 0xff];
    expect(xorChecksum(body)).toBe(0x00);
  });

  test("substitute escapes all five reserved bytes", () => {
    expect(substitute([0x02])).toEqual([0x1b, 0x82]);
    expect(substitute([0x03])).toEqual([0x1b, 0x83]);
    expect(substitute([0x06])).toEqual([0x1b, 0x86]);
    expect(substitute([0x15])).toEqual([0x1b, 0x95]);
    expect(substitute([0x1b])).toEqual([0x1b, 0x9b]);
    expect(substitute([0x88, 0x00])).toEqual([0x88, 0x00]); // untouched
  });

  test("unsubstitute is the inverse of substitute", () => {
    const raw = [0x02, 0x88, 0x03, 0x1b, 0x06, 0x15, 0x42];
    expect(unsubstitute(substitute(raw))).toEqual(raw);
  });

  test("unsubstitute throws on a malformed escape", () => {
    expect(() => unsubstitute([0x1b, 0x00])).toThrow();
    expect(() => unsubstitute([0x42, 0x1b])).toThrow(); // dangling escape
  });
});

describe("int32 encoding", () => {
  test("encodes/decodes signed 32-bit big-endian", () => {
    expect(encodeInt32(-1)).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(decodeInt32([0xff, 0xff, 0xff, 0xff])).toBe(-1);
    expect(encodeInt32(0x00640000)).toEqual([0x00, 0x64, 0x00, 0x00]);
    expect(decodeInt32([0x00, 0x64, 0x00, 0x00])).toBe(0x00640000);
  });
});

describe("percent <-> level", () => {
  test("level 0..1 maps to percent-raw (× 65536)", () => {
    expect(levelToPercentRaw(1)).toBe(100 * 65536);
    expect(levelToPercentRaw(0.5)).toBe(50 * 65536);
    expect(levelToPercentRaw(0)).toBe(0);
  });
  test("round-trips within rounding tolerance", () => {
    for (const lvl of [0, 0.25, 0.5, 0.73, 1]) {
      expect(percentRawToLevel(levelToPercentRaw(lvl))).toBeCloseTo(lvl, 4);
    }
  });
  test("clamps out-of-range input", () => {
    expect(levelToPercentRaw(2)).toBe(100 * 65536);
    expect(levelToPercentRaw(-1)).toBe(0);
  });
});

describe("encodeMessage", () => {
  test("reproduces the exact bss.js reference frame", () => {
    // type SET, node 0x1DFE, vd 0x03, object 0x000109, param 0x0060, value -1.
    const frame = encodeMessage({
      type: MsgType.SET,
      node: 0x1dfe,
      virtualDevice: 0x03,
      object: 0x000109,
      param: 0x0060,
      value: -1,
    });
    // STX, body (with 0x03 → 1b 83), checksum 00, ETX
    expect(hex(frame)).toBe("02 88 1d fe 1b 83 00 01 09 00 60 ff ff ff ff 00 03");
  });

  test("round-trips through decodeFrame", () => {
    const msg = {
      type: MsgType.SET_PERCENT,
      node: 1234,
      virtualDevice: 3,
      object: 0xabcdef,
      param: 0x0102,
      value: levelToPercentRaw(0.5),
    };
    const frame = encodeMessage(msg);
    // strip STX/ETX → inner bytes
    const inner = Array.from(frame.subarray(1, frame.length - 1));
    expect(decodeFrame(inner)).toEqual(msg);
  });

  test("decodeFrame rejects a bad checksum", () => {
    const frame = encodeMessage({
      type: MsgType.SET,
      node: 1,
      virtualDevice: 3,
      object: 2,
      param: 3,
      value: 0,
    });
    const inner = Array.from(frame.subarray(1, frame.length - 1));
    const last = inner.length - 1;
    inner[last] = (inner[last]! ^ 0xff) & 0xff; // corrupt the checksum byte
    expect(decodeFrame(inner)).toBeNull();
  });
});

describe("FrameDecoder", () => {
  test("extracts multiple frames and handles split chunks", () => {
    const a = encodeMessage({ type: MsgType.SET, node: 1, virtualDevice: 3, object: 1, param: 1, value: 1 });
    const b = encodeMessage({ type: MsgType.SET, node: 2, virtualDevice: 3, object: 2, param: 2, value: 2 });
    const dec = new FrameDecoder();

    // Feed all of `a` plus the first half of `b`.
    const mid = Math.floor(b.length / 2);
    const first = dec.push(Uint8Array.from([...a, ...b.subarray(0, mid)]));
    expect(first).toHaveLength(1);
    expect(decodeFrame(first[0]!)!.node).toBe(1);

    // Feed the rest of `b`.
    const second = dec.push(Uint8Array.from(b.subarray(mid)));
    expect(second).toHaveLength(1);
    expect(decodeFrame(second[0]!)!.node).toBe(2);
  });

  test("ignores bytes before the first STX", () => {
    const a = encodeMessage({ type: MsgType.SET, node: 7, virtualDevice: 3, object: 1, param: 1, value: 0 });
    const dec = new FrameDecoder();
    const frames = dec.push(Uint8Array.from([0xde, 0xad, ...a]));
    expect(frames).toHaveLength(1);
    expect(decodeFrame(frames[0]!)!.node).toBe(7);
  });
});
