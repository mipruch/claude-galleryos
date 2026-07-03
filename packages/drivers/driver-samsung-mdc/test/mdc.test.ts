/**
 * Unit tests for the pure Samsung MDC codec (`src/mdc.ts`).
 *
 * The known-good hex frames below (`AA 11 00 01 01 13` etc.) match the worked
 * examples cross-checked against the public MDC protocol reference used to
 * build this driver — see `mdc.ts`'s header comment.
 */

import { describe, expect, test } from "bun:test";
import {
  MdcFrameDecoder,
  PowerState,
  decodePowerState,
  decodeResponse,
  encodePowerQuery,
  encodePowerSet,
} from "../src/mdc.ts";

describe("encodePowerSet / encodePowerQuery", () => {
  test("power ON: AA 11 00 01 01 13", () => {
    expect([...encodePowerSet(0, PowerState.ON)]).toEqual([0xaa, 0x11, 0x00, 0x01, 0x01, 0x13]);
  });

  test("power OFF: AA 11 00 01 00 12", () => {
    expect([...encodePowerSet(0, PowerState.OFF)]).toEqual([0xaa, 0x11, 0x00, 0x01, 0x00, 0x12]);
  });

  test("power query has zero-length data", () => {
    expect([...encodePowerQuery(3)]).toEqual([0xaa, 0x11, 0x03, 0x00, 0x14]);
  });

  test("checksum wraps past 0xFF", () => {
    // displayId 0xFE (broadcast-style id) pushes the sum over 256.
    const frame = [...encodePowerSet(0xfe, PowerState.ON)];
    const body = frame.slice(1, 5);
    const expected = body.reduce((sum, b) => sum + b, 0) & 0xff;
    expect(frame[5]).toBe(expected);
  });
});

describe("decodeResponse", () => {
  test("ACK to a power query carries the current state", () => {
    // AA FF 00 03 41 11 01 <checksum>
    const body = [0xff, 0x00, 0x03, 0x41, 0x11, 0x01];
    const cs = body.reduce((s, b) => s + b, 0) & 0xff;
    const frame = [0xaa, ...body, cs];
    expect(decodeResponse(frame)).toEqual({ ack: true, displayId: 0, command: 0x11, data: [0x01] });
  });

  test("NAK carries an error code instead of reply data", () => {
    // AA FF 02 03 4E 11 01 <checksum> — NAK + echoed cmd (0x11) + 1-byte error code (0x01).
    const body = [0xff, 0x02, 0x03, 0x4e, 0x11, 0x01];
    const cs = body.reduce((s, b) => s + b, 0) & 0xff;
    const frame = [0xaa, ...body, cs];
    expect(decodeResponse(frame)).toEqual({ ack: false, displayId: 2, command: 0x11, data: [0x01] });
  });

  test("rejects a bad checksum", () => {
    const body = [0xff, 0x00, 0x03, 0x41, 0x11, 0x01];
    const frame = [0xaa, ...body, 0x00]; // wrong checksum
    expect(decodeResponse(frame)).toBeNull();
  });

  test("rejects a non-response frame (wrong marker)", () => {
    expect(decodeResponse([0xaa, 0x11, 0x00, 0x01, 0x01, 0x13])).toBeNull();
  });

  test("rejects a truncated frame", () => {
    expect(decodeResponse([0xaa, 0xff, 0x00, 0x03, 0x41])).toBeNull();
  });
});

describe("MdcFrameDecoder", () => {
  test("decodes one frame delivered in a single chunk", () => {
    const decoder = new MdcFrameDecoder();
    const body = [0xff, 0x01, 0x03, 0x41, 0x11, 0x00];
    const cs = body.reduce((s, b) => s + b, 0) & 0xff;
    const frame = Uint8Array.from([0xaa, ...body, cs]);

    const responses = decoder.push(frame);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toEqual({ ack: true, displayId: 1, command: 0x11, data: [0x00] });
  });

  test("decodes a frame split across multiple chunks", () => {
    const decoder = new MdcFrameDecoder();
    const body = [0xff, 0x01, 0x03, 0x41, 0x11, 0x01];
    const cs = body.reduce((s, b) => s + b, 0) & 0xff;
    const bytes = [0xaa, ...body, cs];

    expect(decoder.push(Uint8Array.from(bytes.slice(0, 3)))).toHaveLength(0);
    expect(decoder.push(Uint8Array.from(bytes.slice(3, 6)))).toHaveLength(0);
    const responses = decoder.push(Uint8Array.from(bytes.slice(6)));
    expect(responses).toHaveLength(1);
    expect(responses[0]?.data).toEqual([0x01]);
  });

  test("resyncs past garbage bytes before a valid frame", () => {
    const decoder = new MdcFrameDecoder();
    const body = [0xff, 0x05, 0x03, 0x41, 0x11, 0x01];
    const cs = body.reduce((s, b) => s + b, 0) & 0xff;
    const garbage = [0x00, 0xaa, 0x11]; // stray byte + a non-response frame start
    const frame = [0xaa, ...body, cs];

    const responses = decoder.push(Uint8Array.from([...garbage, ...frame]));
    expect(responses).toHaveLength(1);
    expect(responses[0]?.displayId).toBe(5);
  });

  test("two frames back to back both decode", () => {
    const decoder = new MdcFrameDecoder();
    const bodyA = [0xff, 0x01, 0x03, 0x41, 0x11, 0x00];
    const csA = bodyA.reduce((s, b) => s + b, 0) & 0xff;
    const bodyB = [0xff, 0x02, 0x03, 0x41, 0x11, 0x01];
    const csB = bodyB.reduce((s, b) => s + b, 0) & 0xff;

    const responses = decoder.push(Uint8Array.from([0xaa, ...bodyA, csA, 0xaa, ...bodyB, csB]));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({ displayId: 1, data: [0x00] });
    expect(responses[1]).toMatchObject({ displayId: 2, data: [0x01] });
  });
});

describe("decodePowerState", () => {
  test("maps known bytes and falls back to unknown", () => {
    expect(decodePowerState([0x00])).toBe("off");
    expect(decodePowerState([0x01])).toBe("on");
    expect(decodePowerState([0x02])).toBe("unknown"); // REBOOT isn't a settled state
    expect(decodePowerState([])).toBe("unknown");
  });
});
