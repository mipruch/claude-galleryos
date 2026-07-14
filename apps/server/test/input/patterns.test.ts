/**
 * Pure address pattern matching tests — no cache, no dispatch. Covers exact vs.
 * parameterised patterns and path-param capture. Template evaluation lives in
 * `test/core/templating.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { compilePattern, matchPattern } from "../../src/input/patterns.ts";

const match = (pattern: string, address: string) => matchPattern(compilePattern(pattern), address);

describe("matchPattern — exact", () => {
  test("equal address matches with no params", () => {
    expect(match("/scene/execute", "/scene/execute")).toEqual({});
  });
  test("different address does not match", () => {
    expect(match("/scene/execute", "/scene/stop")).toBeNull();
  });
  test("an extra segment does not match an exact pattern", () => {
    expect(match("/scene/execute", "/scene/execute/now")).toBeNull();
  });
});

describe("matchPattern — parameterised", () => {
  test("captures a single path param", () => {
    expect(match("/dim/:level", "/dim/0.5")).toEqual({ level: "0.5" });
  });
  test("captures multiple params", () => {
    expect(match("/room/:room/scene/:scene", "/room/hallA/scene/welcome")).toEqual({
      room: "hallA",
      scene: "welcome",
    });
  });
  test("literal segments around a param must still match", () => {
    expect(match("/dim/:level", "/bright/0.5")).toBeNull();
  });
  test("segment count must match exactly", () => {
    expect(match("/dim/:level", "/dim/0.5/extra")).toBeNull();
    expect(match("/dim/:level", "/dim")).toBeNull();
  });
});
