/**
 * Foxtron codec unit tests — pure, no sockets.
 *
 * Validates checksum calculation, encoding, decoding, and frame streaming
 * against the manual's worked example.
 */

import { describe, expect, test } from "bun:test";
import {
  DaliAddr,
  FrameDecoder,
  calcChecksum,
  decodeFrame,
  encodeFrame,
  levelToDapc,
  dapcToLevel,
  buildSendDali,
  buildSendDaliOrig,
  buildConfigQuery,
  targetDapcByte,
  targetCmdByte,
  targetKey,
} from "../src/foxtron-codec.ts";

describe("checksum", () => {
  test("matches the manual's worked example", () => {
    // data = [0x01, 0x00, 0x10, 0xFF, 0x10], expected checksum = 0xDF
    expect(calcChecksum([0x01, 0x00, 0x10, 0xFF, 0x10])).toBe(0xDF);
  });

  test("all-zero data has checksum 0xFF", () => {
    expect(calcChecksum([0x00])).toBe(0xFF);
  });
});

describe("encode / decode round-trip", () => {
  test("encodes to the manual's example wire bytes", () => {
    // data = [0x01, 0x00, 0x10, 0xFF, 0x10], checksum = 0xDF
    // ASCII: "010010FF10DF"  → 0x30 0x31 0x30 0x30 0x31 0x30 0x46 0x46 0x31 0x30 0x44 0x46
    const frame = encodeFrame([0x01, 0x00, 0x10, 0xFF, 0x10]);
    expect(frame[0]).toBe(0x01);  // SOH
    expect(frame[frame.length - 1]).toBe(0x17); // ETB
    const ascii = frame.subarray(1, frame.length - 1).toString("ascii");
    expect(ascii).toBe("010010FF10DF");
  });

  test("round-trips arbitrary data", () => {
    for (const data of [
      [0x06, 0x03],                           // config query item 3
      [0x0B, 0x00, 0x10, 0x02, 0xA0, 0x00],  // Type 11 query actual level addr 1
      [0x07, 0x03, 0x00, 0x00],               // config response busStatus=0
    ]) {
      const frame = encodeFrame(data);
      const ascii = frame.subarray(1, frame.length - 1).toString("ascii");
      const { data: decoded, valid } = decodeFrame(ascii);
      expect(valid).toBe(true);
      expect(decoded).toEqual(data);
    }
  });

  test("decodeFrame rejects a corrupted checksum", () => {
    const frame = encodeFrame([0x01, 0x00, 0x10, 0xFF, 0x10]);
    const ascii = frame.subarray(1, frame.length - 1).toString("ascii");
    // Flip the last char (part of checksum).
    const bad = ascii.slice(0, -1) + (ascii.at(-1) === "F" ? "E" : "F");
    const { valid } = decodeFrame(bad);
    expect(valid).toBe(false);
  });

  test("decodeFrame rejects odd-length or too-short input", () => {
    expect(decodeFrame("ABC").valid).toBe(false);  // odd length
    expect(decodeFrame("AB").valid).toBe(false);   // too short (need ≥4)
  });
});

describe("FrameDecoder streaming", () => {
  test("extracts a single frame from a full chunk", () => {
    const frame = encodeFrame([0x06, 0x03]);
    const dec = new FrameDecoder();
    const frames = dec.push(Uint8Array.from(frame));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([0x06, 0x03]);
  });

  test("handles two frames concatenated", () => {
    const a = encodeFrame([0x06, 0x03]);
    const b = encodeFrame([0x07, 0x03, 0x00, 0x00]);
    const dec = new FrameDecoder();
    const frames = dec.push(Uint8Array.from([...a, ...b]));
    expect(frames).toHaveLength(2);
    expect(frames[0]![0]).toBe(0x06);
    expect(frames[1]![0]).toBe(0x07);
  });

  test("handles a frame split across two chunks", () => {
    const frame = encodeFrame([0x01, 0x00, 0x10, 0xFF, 0x10]);
    const dec = new FrameDecoder();
    const mid = 4;
    const first = dec.push(Uint8Array.from(frame.subarray(0, mid)));
    expect(first).toHaveLength(0);
    const second = dec.push(Uint8Array.from(frame.subarray(mid)));
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual([0x01, 0x00, 0x10, 0xFF, 0x10]);
  });

  test("ignores bytes before SOH", () => {
    const frame = encodeFrame([0x06, 0x02]);
    const dec = new FrameDecoder();
    const frames = dec.push(Uint8Array.from([0xAA, 0xBB, ...frame]));
    expect(frames).toHaveLength(1);
    expect(frames[0]![0]).toBe(0x06);
  });
});

describe("DALI addressing helpers", () => {
  test("unicast DAPC: addr*2", () => {
    expect(DaliAddr.unicastDapc(0)).toBe(0);
    expect(DaliAddr.unicastDapc(1)).toBe(2);
    expect(DaliAddr.unicastDapc(63)).toBe(126);
  });
  test("unicast command: addr*2+1", () => {
    expect(DaliAddr.unicastCmd(0)).toBe(1);
    expect(DaliAddr.unicastCmd(1)).toBe(3);
    expect(DaliAddr.unicastCmd(63)).toBe(127);
  });
  test("broadcast addresses are 0xFE / 0xFF", () => {
    expect(DaliAddr.broadcastDapc).toBe(0xFE);
    expect(DaliAddr.broadcastCmd).toBe(0xFF);
  });
});

describe("target addressing", () => {
  test("address target → unicast bytes (addr*2 / addr*2+1)", () => {
    expect(targetDapcByte({ mode: "address", address: 5 })).toBe(10);
    expect(targetCmdByte({ mode: "address", address: 5 })).toBe(11);
  });
  test("group target → group bytes (g*2+0x80 / g*2+0x81)", () => {
    expect(targetDapcByte({ mode: "group", group: 0 })).toBe(0x80);
    expect(targetCmdByte({ mode: "group", group: 0 })).toBe(0x81);
    expect(targetDapcByte({ mode: "group", group: 2 })).toBe(0x84);
    expect(targetCmdByte({ mode: "group", group: 2 })).toBe(0x85);
    expect(targetDapcByte({ mode: "group", group: 15 })).toBe(0x9E);
  });
  test("broadcast target → 0xFE / 0xFF", () => {
    expect(targetDapcByte({ mode: "broadcast" })).toBe(0xFE);
    expect(targetCmdByte({ mode: "broadcast" })).toBe(0xFF);
  });
  test("targetKey is stable and distinct per target", () => {
    expect(targetKey({ mode: "address", address: 5 })).toBe("a5");
    expect(targetKey({ mode: "group", group: 2 })).toBe("g2");
    expect(targetKey({ mode: "broadcast" })).toBe("bc");
  });
  test("group DAPC byte matches the reference script (group 0 = 0x80)", () => {
    // Reference: 0x01 0x00 0x10 0x80 0xFA = Type 1, group 0 DAPC, level 250
    expect(targetDapcByte({ mode: "group", group: 0 })).toBe(0x80);
  });
});

describe("level ↔ DAPC conversion", () => {
  test("0.0 → 0, 1.0 → 254", () => {
    expect(levelToDapc(0)).toBe(0);
    expect(levelToDapc(1)).toBe(254);
  });
  test("round-trips within rounding tolerance", () => {
    for (const l of [0, 0.25, 0.5, 0.73, 1]) {
      expect(dapcToLevel(levelToDapc(l))).toBeCloseTo(l, 1);
    }
  });
  test("clamps out-of-range", () => {
    expect(levelToDapc(2)).toBe(254);
    expect(levelToDapc(-1)).toBe(0);
  });
});

describe("message builders", () => {
  test("buildSendDali wraps a 16-bit DALI frame", () => {
    const data = buildSendDali([0xFF, 0x10]);
    expect(data[0]).toBe(0x01);  // type 1
    expect(data[2]).toBe(16);    // 16 bits
    expect(data[3]).toBe(0xFF);
    expect(data[4]).toBe(0x10);
  });
  test("buildSendDaliOrig wraps with type 11 + flags byte", () => {
    const data = buildSendDaliOrig([0x05, 0xA0], 0, false);
    expect(data[0]).toBe(0x0B);  // type 11
    expect(data[data.length - 1]).toBe(0x00); // flags=0
  });
  test("buildConfigQuery wraps type 6 + item", () => {
    expect(buildConfigQuery(3)).toEqual([0x06, 0x03]);
  });
});
