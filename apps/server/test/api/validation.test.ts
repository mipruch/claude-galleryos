/**
 * Manifest-schema validation tests — hermetic (no DB / Redis / subprocesses).
 *
 * Covers the three `assert*` guards directly (valid input passes; each failure
 * mode throws a 400 HttpError with VALIDATION/BAD_REQUEST and Ajv details), then
 * a route-level check that a bad connection config / device address surfaces as
 * an HTTP 400 through the real route maps.
 */

import { describe, expect, test } from "bun:test";
import type { Server } from "bun";
import {
  assertValidCommandParams,
  assertValidConnectionConfig,
  assertValidDeviceAddress,
} from "../../src/api/validation.ts";
import { HttpError } from "../../src/api/http.ts";
import { connectionsRoutes } from "../../src/api/routes/connections.ts";
import { devicesRoutes } from "../../src/api/routes/devices.ts";
import type { ApiContext } from "../../src/api/context.ts";

/** Run `fn`, returning the thrown HttpError (or failing the test). */
function expectHttpError(fn: () => void): HttpError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
  throw new Error("expected the call to throw, but it did not");
}

describe("assertValidConnectionConfig", () => {
  test("accepts a valid pjlink form (host + port)", () => {
    expect(() => assertValidConnectionConfig("pjlink", { host: "192.168.1.50", port: 4352 })).not.toThrow();
  });

  test("rejects a missing required host", () => {
    const err = expectHttpError(() => assertValidConnectionConfig("pjlink", { port: 4352 }));
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION");
    expect(Array.isArray(err.details)).toBe(true);
  });

  test("rejects a wrong-typed field (port as string)", () => {
    const err = expectHttpError(() =>
      assertValidConnectionConfig("netio", { host: "10.0.0.9", port: "eighty" }),
    );
    expect(err.code).toBe("VALIDATION");
  });

  test("rejects an out-of-range port", () => {
    const err = expectHttpError(() => assertValidConnectionConfig("pjlink", { host: "h", port: 70000 }));
    expect(err.code).toBe("VALIDATION");
  });

  test("rejects an unknown driver", () => {
    const err = expectHttpError(() => assertValidConnectionConfig("nope", { host: "h" }));
    expect(err.code).toBe("BAD_REQUEST");
  });
});

describe("assertValidDeviceAddress", () => {
  test("accepts a valid bss fader address", () => {
    expect(() =>
      assertValidDeviceAddress("bss-soundweb", "bss-soundweb.fader", {
        node: 7678,
        virtualDevice: 3,
        object: 265,
        gainParam: 96,
        muteParam: 97,
      }),
    ).not.toThrow();
  });

  test("rejects a missing required address field (object)", () => {
    const err = expectHttpError(() =>
      assertValidDeviceAddress("bss-soundweb", "bss-soundweb.fader", { node: 7678 }),
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION");
  });

  test("rejects an unknown property (additionalProperties:false)", () => {
    const err = expectHttpError(() =>
      assertValidDeviceAddress("netio", "netio.socket", { outputId: 1, extra: true }),
    );
    expect(err.code).toBe("VALIDATION");
  });

  test("rejects an unknown endpoint type", () => {
    const err = expectHttpError(() => assertValidDeviceAddress("pjlink", "pjlink.nope", {}));
    expect(err.code).toBe("BAD_REQUEST");
  });
});

describe("assertValidCommandParams", () => {
  test("accepts a valid setLevel (0..1)", () => {
    expect(() =>
      assertValidCommandParams("bss-soundweb", "bss-soundweb.fader", "setLevel", { level: 0.5 }),
    ).not.toThrow();
  });

  test("rejects level above the 0..1 range", () => {
    const err = expectHttpError(() =>
      assertValidCommandParams("bss-soundweb", "bss-soundweb.fader", "setLevel", { level: 80 }),
    );
    expect(err.code).toBe("VALIDATION");
  });

  test("rejects level below the 0..1 range", () => {
    const err = expectHttpError(() =>
      assertValidCommandParams("bss-soundweb", "bss-soundweb.fader", "setLevel", { level: -6 }),
    );
    expect(err.code).toBe("VALIDATION");
  });

  test("rejects setMute with the wrong param name (mute instead of muted)", () => {
    const err = expectHttpError(() =>
      assertValidCommandParams("bss-soundweb", "bss-soundweb.fader", "setMute", { mute: false }),
    );
    expect(err.code).toBe("VALIDATION");
  });

  test("accepts setMute with the canonical muted param", () => {
    expect(() =>
      assertValidCommandParams("bss-soundweb", "bss-soundweb.fader", "setMute", { muted: false }),
    ).not.toThrow();
  });

  test("rejects an unknown command", () => {
    const err = expectHttpError(() =>
      assertValidCommandParams("pjlink", "pjlink.projector", "explode", {}),
    );
    expect(err.code).toBe("BAD_REQUEST");
  });
});

// ── route-level: validation surfaces as HTTP 400 ─────────────────

async function req(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("routes reject invalid input with 400", () => {
  const ctx = {
    driverRegistry: { has: () => true, get: () => undefined },
    connections: { async get() { return { id: "c1", driverId: "netio" }; } },
    devices: {},
    deviceManager: {},
  } as unknown as ApiContext;

  let server: Server<unknown>;
  let base: string;

  test("POST /connections with a missing host → 400 VALIDATION", async () => {
    server = Bun.serve({ port: 0, routes: { ...connectionsRoutes(ctx) } });
    try {
      base = `http://localhost:${server.port}`;
      const { status, body } = await req(base, "POST", "/api/v1/connections", {
        name: "X",
        driverId: "pjlink",
        port: 4352,
      });
      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION");
    } finally {
      server.stop(true);
    }
  });

  test("POST /devices with a bad address → 400 VALIDATION", async () => {
    server = Bun.serve({ port: 0, routes: { ...devicesRoutes(ctx) } });
    try {
      base = `http://localhost:${server.port}`;
      const { status, body } = await req(base, "POST", "/api/v1/devices", {
        connectionId: "c1",
        name: "Sock",
        type: "power",
        subtype: "netio.socket",
        address: { outputId: 99 }, // out of the 1..8 range
      });
      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION");
    } finally {
      server.stop(true);
    }
  });
});
