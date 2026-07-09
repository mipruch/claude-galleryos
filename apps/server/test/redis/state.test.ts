/**
 * Pure unit tests for the live-state merge logic (no Redis).
 *
 * This is a plain shallow merge — no vendor-specific rules live here. (The DALI
 * "remember brightness while off" behaviour used to be a special case in this
 * file; it now lives in DaliLunatoneDriver/DaliFoxtronDriver themselves, each
 * covered by its own driver-level tests, so a driver reports state that's
 * already correct and core never needs to second-guess it.)
 */

import { describe, expect, test } from "bun:test";
import { mergeDeviceState } from "../../src/redis/state.ts";

describe("mergeDeviceState", () => {
  test("a plain patch is merged over the existing state", () => {
    expect(mergeDeviceState({ level: 0.5, muted: false }, { muted: true })).toEqual({
      level: 0.5,
      muted: true,
    });
  });

  test("a patch key overwrites the existing value, even to a falsy one", () => {
    expect(mergeDeviceState({ brightness: 0.7 }, { on: false, brightness: 0 })).toEqual({
      brightness: 0,
      on: false,
    });
  });

  test("keys absent from the patch are left untouched", () => {
    expect(mergeDeviceState({ brightness: 0.7, level: 0.5 }, { on: false })).toEqual({
      brightness: 0.7,
      level: 0.5,
      on: false,
    });
  });

  test("an empty existing state is just the patch", () => {
    expect(mergeDeviceState({}, { on: false, brightness: 0 })).toEqual({ on: false, brightness: 0 });
  });
});
