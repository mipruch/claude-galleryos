/**
 * Pure OSC decoder tests — round-trips packets built by the test encoder and
 * checks edge cases (padding, no-arg messages, bundles, malformed input).
 */

import { describe, expect, test } from "bun:test";
import { OscParseError, decodeOscPacket } from "../../src/input/osc.ts";
import { encodeOscBundle, encodeOscMessage, oscString } from "./osc-encode.ts";

describe("decodeOscPacket — messages", () => {
  test("address with no args", () => {
    expect(decodeOscPacket(encodeOscMessage("/scene/execute"))).toEqual([
      { address: "/scene/execute", args: [] },
    ]);
  });

  test("float arg (typical fader value)", () => {
    const [msg] = decodeOscPacket(encodeOscMessage("/dim", [{ tag: "f", value: 0.5 }]));
    expect(msg!.address).toBe("/dim");
    expect(msg!.args[0]).toBeCloseTo(0.5, 6);
  });

  test("int and string args in order", () => {
    expect(
      decodeOscPacket(
        encodeOscMessage("/cmd", [{ tag: "i", value: 42 }, { tag: "s", value: "HDMI1" }]),
      ),
    ).toEqual([{ address: "/cmd", args: [42, "HDMI1"] }]);
  });

  test("boolean tags T/F carry no bytes", () => {
    expect(decodeOscPacket(encodeOscMessage("/mute", [{ tag: "T" }, { tag: "F" }]))).toEqual([
      { address: "/mute", args: [true, false] },
    ]);
  });

  test("blob round-trips as bytes", () => {
    const blob = new Uint8Array([1, 2, 3]);
    const [msg] = decodeOscPacket(encodeOscMessage("/raw", [{ tag: "b", value: blob }]));
    expect(Array.from(msg!.args[0] as Uint8Array)).toEqual([1, 2, 3]);
  });

  test("string padding is handled for every length mod 4", () => {
    for (const addr of ["/a", "/ab", "/abc", "/abcd", "/abcde"]) {
      expect(decodeOscPacket(encodeOscMessage(addr))[0]!.address).toBe(addr);
    }
  });
});

describe("decodeOscPacket — bundles", () => {
  test("unwraps every contained message in order", () => {
    const packet = encodeOscBundle([
      encodeOscMessage("/a", [{ tag: "i", value: 1 }]),
      encodeOscMessage("/b", [{ tag: "i", value: 2 }]),
    ]);
    expect(decodeOscPacket(packet)).toEqual([
      { address: "/a", args: [1] },
      { address: "/b", args: [2] },
    ]);
  });

  test("nested bundles flatten", () => {
    const packet = encodeOscBundle([
      encodeOscMessage("/x"),
      encodeOscBundle([encodeOscMessage("/y")]),
    ]);
    expect(decodeOscPacket(packet).map((m) => m.address)).toEqual(["/x", "/y"]);
  });
});

describe("decodeOscPacket — malformed input", () => {
  test("empty datagram yields nothing", () => {
    expect(decodeOscPacket(new Uint8Array(0))).toEqual([]);
  });

  test("a packet not starting with '/' or '#' throws", () => {
    expect(() => decodeOscPacket(oscString("nope"))).toThrow(OscParseError);
  });

  test("an unknown type tag throws", () => {
    // address "/x", type tags ",Q" (Q is unsupported)
    const bytes = new Uint8Array([...oscString("/x"), ...oscString(",Q")]);
    expect(() => decodeOscPacket(bytes)).toThrow(OscParseError);
  });

  test("a truncated argument throws rather than reading past the end", () => {
    // claims an int32 arg but provides no payload bytes
    const bytes = new Uint8Array([...oscString("/x"), ...oscString(",i")]);
    expect(() => decodeOscPacket(bytes)).toThrow(OscParseError);
  });
});
