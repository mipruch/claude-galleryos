/**
 * Pure unit tests for the live-state merge logic (no Redis).
 *
 * Covers the DALI "remember brightness while off" rule: a driver reports
 * `brightness: 0` whenever a light is physically off, but the stored state must
 * keep the last intended level so sliders stay put and turning back on restores it.
 */

import { describe, expect, test } from "bun:test";
import { mergeDeviceState, shouldPreserveBrightness } from "../../src/redis/state.ts";

describe("mergeDeviceState", () => {
  test("a plain patch is merged over the existing state", () => {
    expect(mergeDeviceState({ level: 0.5, muted: false }, { muted: true })).toEqual({
      level: 0.5,
      muted: true,
    });
  });

  test("turning off preserves a known non-zero brightness", () => {
    // Driver reports brightness:0 alongside on:false — keep the last level.
    expect(mergeDeviceState({ brightness: 0.7 }, { on: false, brightness: 0 })).toEqual({
      brightness: 0.7,
      on: false,
    });
  });

  test("turning off does NOT invent a brightness when none was known", () => {
    expect(mergeDeviceState({}, { on: false, brightness: 0 })).toEqual({ on: false, brightness: 0 });
  });

  test("an explicit non-zero brightness in the patch wins", () => {
    expect(mergeDeviceState({ brightness: 0.7 }, { on: true, brightness: 0.3 })).toEqual({
      brightness: 0.3,
      on: true,
    });
  });

  test("`power: false` triggers the same preservation as `on: false`", () => {
    expect(mergeDeviceState({ brightness: 0.4 }, { power: false, brightness: 0 })).toEqual({
      brightness: 0.4,
      power: false,
    });
  });
});

describe("shouldPreserveBrightness", () => {
  test("true only when turning off, the merge has no brightness, and one was known", () => {
    expect(shouldPreserveBrightness({ brightness: 0.5 }, { on: false, brightness: 0 })).toBe(true);
    expect(shouldPreserveBrightness({}, { on: false, brightness: 0 })).toBe(false); // nothing to keep
    expect(shouldPreserveBrightness({ brightness: 0.5 }, { on: true, brightness: 0 })).toBe(false); // not off
    expect(shouldPreserveBrightness({ brightness: 0.5 }, { on: false, brightness: 0.2 })).toBe(false); // has level
  });
});
