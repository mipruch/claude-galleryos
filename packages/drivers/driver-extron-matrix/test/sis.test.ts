/**
 * Unit tests for the pure SIS codec (`src/sis.ts`).
 */

import { describe, expect, test } from "bun:test";
import {
  buildQueryCommand,
  buildTieCommand,
  parseResponseLine,
} from "../src/sis.ts";

describe("buildTieCommand", () => {
  test("AV / video / audio symbols", () => {
    expect(buildTieCommand(5, 2, "av")).toBe("5*2!");
    expect(buildTieCommand(5, 2, "video")).toBe("5*2%");
    expect(buildTieCommand(5, 2, "audio")).toBe("5*2$");
  });

  test("input 0 unties the output", () => {
    expect(buildTieCommand(0, 3, "av")).toBe("0*3!");
  });
});

describe("buildQueryCommand", () => {
  test("query has no input prefix", () => {
    expect(buildQueryCommand(4, "video")).toBe("4%");
    expect(buildQueryCommand(4, "audio")).toBe("4$");
    expect(buildQueryCommand(4, "av")).toBe("4!");
  });
});

describe("parseResponseLine", () => {
  test("tie confirmation (All/Vid/Aud), zero-padded", () => {
    expect(parseResponseLine("Out02 In05 All")).toEqual({
      kind: "tie",
      output: 2,
      input: 5,
      type: "av",
    });
    expect(parseResponseLine("Out2 In5 Vid")).toMatchObject({ kind: "tie", type: "video" });
    expect(parseResponseLine("Out08 In00 Aud")).toMatchObject({
      kind: "tie",
      output: 8,
      input: 0,
      type: "audio",
    });
  });

  test("RGB plane maps to video", () => {
    expect(parseResponseLine("Out01 In03 RGB")).toMatchObject({ kind: "tie", type: "video" });
  });

  test("query number response, padded or with In prefix", () => {
    expect(parseResponseLine("In05")).toEqual({ kind: "number", value: 5 });
    expect(parseResponseLine("05")).toEqual({ kind: "number", value: 5 });
    expect(parseResponseLine("0")).toEqual({ kind: "number", value: 0 });
  });

  test("error codes carry a message", () => {
    expect(parseResponseLine("E13")).toMatchObject({
      kind: "error",
      code: "E13",
      message: "invalid value (out of range)",
    });
    expect(parseResponseLine("E99")).toMatchObject({ kind: "error", code: "E99", message: "unknown error" });
  });

  test("banner / password / login classified as info", () => {
    expect(parseResponseLine("Password:")).toMatchObject({ kind: "info", tag: "password" });
    expect(parseResponseLine("Login Administrator")).toMatchObject({ kind: "info", tag: "login" });
    expect(parseResponseLine("(c) Copyright 2024, Extron Electronics")).toMatchObject({
      kind: "info",
      tag: "banner",
    });
  });
});
