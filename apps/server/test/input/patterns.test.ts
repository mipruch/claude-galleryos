/**
 * Pure pattern matching + template evaluation tests — no cache, no dispatch.
 * Covers exact vs. parameterised patterns, path-param capture, the three token
 * forms (`{arg[N]}`, `{:name}`, literals), interpolation, type preservation /
 * coercion, nesting, and unresolved-reference handling.
 */

import { describe, expect, test } from "bun:test";
import { compilePattern, evaluateTemplate, matchPattern } from "../../src/input/patterns.ts";

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

describe("evaluateTemplate — literals pass through", () => {
  test("non-string values are untouched", () => {
    expect(evaluateTemplate({ muted: false, count: 3, nil: null }, [], {})).toEqual({
      muted: false,
      count: 3,
      nil: null,
    });
  });
  test("plain strings without tokens pass through", () => {
    expect(evaluateTemplate({ label: "Hall A" }, [], {})).toEqual({ label: "Hall A" });
  });
});

describe("evaluateTemplate — arg references", () => {
  test("whole-token arg keeps its original type", () => {
    expect(evaluateTemplate({ level: "{arg[0]}" }, [0.5], {})).toEqual({ level: 0.5 });
    expect(evaluateTemplate({ on: "{arg[0]}" }, [true], {})).toEqual({ on: true });
  });
  test("positional indexing", () => {
    expect(evaluateTemplate({ a: "{arg[0]}", b: "{arg[1]}" }, ["x", "y"], {})).toEqual({ a: "x", b: "y" });
  });
  test("out-of-range arg drops the key (whole token)", () => {
    expect(evaluateTemplate({ level: "{arg[2]}" }, [0.5], {})).toEqual({});
  });
});

describe("evaluateTemplate — path-param references", () => {
  test("whole-token numeric param is coerced to a number", () => {
    expect(evaluateTemplate({ level: "{:level}" }, [], { level: "0.5" })).toEqual({ level: 0.5 });
  });
  test("whole-token boolean param is coerced", () => {
    expect(evaluateTemplate({ muted: "{:m}" }, [], { m: "true" })).toEqual({ muted: true });
  });
  test("non-numeric param stays a string", () => {
    expect(evaluateTemplate({ input: "{:src}" }, [], { src: "HDMI1" })).toEqual({ input: "HDMI1" });
  });
  test("missing path param drops the key", () => {
    expect(evaluateTemplate({ level: "{:nope}" }, [], { level: "0.5" })).toEqual({});
  });
});

describe("evaluateTemplate — interpolation", () => {
  test("embedded tokens stringify into surrounding text", () => {
    expect(evaluateTemplate({ msg: "level {arg[0]} on {:room}" }, [7], { room: "A" })).toEqual({
      msg: "level 7 on A",
    });
  });
  test("missing references interpolate as empty string", () => {
    expect(evaluateTemplate({ msg: "x{arg[5]}y" }, [], {})).toEqual({ msg: "xy" });
  });
});

describe("evaluateTemplate — nested structures", () => {
  test("recurses into objects and arrays", () => {
    const out = evaluateTemplate(
      { color: { r: "{arg[0]}", g: 0 }, tags: ["{:room}", "lit"] },
      [255],
      { room: "A" },
    );
    expect(out).toEqual({ color: { r: 255, g: 0 }, tags: ["A", "lit"] });
  });
});
