/**
 * In-process mock of a Lunatone DALI-2 IoT gateway (HTTP REST + JSON), built on
 * Bun.serve. Implements just enough of the API for driver tests:
 *  - GET  /info
 *  - GET  /devices
 *  - GET  /device/:id
 *  - POST /device/:id/control   (applies a ControlData object)
 *  - POST /dali/scan + GET /dali/scan   (synthetic, completes immediately)
 *
 * Fixtures start as two registered devices so discovery/readState have data.
 */

export interface DaliMockServer {
  /** Base host the gateway listens on (always 127.0.0.1). */
  host: string;
  /** Ephemeral port chosen by the OS. */
  port: number;
  stop: () => void;
  /** Current device state, for assertions. Keyed by IoT id. */
  state: () => Record<number, { power: boolean; dim: number; lastScene?: number }>;
}

interface MockDevice {
  id: number;
  name: string;
  address: number;
  power: boolean;
  dim: number; // 0..100
  lastScene?: number;
}

interface ControlData {
  switchable?: boolean;
  dimmable?: number;
  scene?: number;
}

export function startDaliIotMock(): DaliMockServer {
  const devices = new Map<number, MockDevice>([
    [1, { id: 1, name: "DALI #0", address: 0, power: false, dim: 0 }],
    [2, { id: 2, name: "DALI #1", address: 1, power: true, dim: 100 }],
  ]);
  const scanStatus: "in progress" | "done" = "done";

  const serialise = (d: MockDevice) => ({
    id: d.id,
    name: d.name,
    address: d.address,
    line: 0,
    type: "default",
    features: {
      switchable: { status: d.power },
      dimmable: { status: d.dim },
    },
    scenes: [],
    groups: [],
    daliTypes: [8],
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const applyControl = (d: MockDevice, c: ControlData) => {
    if (c.switchable !== undefined) {
      d.power = c.switchable;
      if (!c.switchable) d.dim = 0;
    }
    if (c.dimmable !== undefined) {
      d.dim = c.dimmable;
      d.power = c.dimmable > 0;
    }
    if (c.scene !== undefined) d.lastScene = c.scene;
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      if (method === "GET" && path === "/info") {
        return json({ name: "DALI-2 IoT Mock", software: "1.4.0", firmware: "1.0.0" });
      }

      if (method === "GET" && path === "/devices") {
        return json({
          devices: [...devices.values()].map(serialise),
          timeSignature: { timestamp: Date.now() / 1000, counter: 1 },
        });
      }

      if (method === "POST" && path === "/dali/scan") {
        return json({ id: "mock-scan", progress: 0, found: 0, status: "in progress" });
      }
      if (method === "GET" && path === "/dali/scan") {
        return json({ id: "mock-scan", progress: 100, found: devices.size, status: scanStatus });
      }

      const ctrl = path.match(/^\/device\/(\d+)\/control$/);
      if (method === "POST" && ctrl) {
        const dev = devices.get(Number(ctrl[1]));
        if (!dev) return json({ error: "not found" }, 404);
        applyControl(dev, (await req.json()) as ControlData);
        return json(serialise(dev));
      }

      const one = path.match(/^\/device\/(\d+)$/);
      if (method === "GET" && one) {
        const dev = devices.get(Number(one[1]));
        if (!dev) return json({ error: "not found" }, 404);
        return json(serialise(dev));
      }

      return json({ error: "not found", path }, 404);
    },
  });

  return {
    host: "127.0.0.1",
    port: server.port!,
    stop: () => server.stop(true),
    state: () =>
      Object.fromEntries(
        [...devices.values()].map((d) => [
          d.id,
          { power: d.power, dim: d.dim, lastScene: d.lastScene },
        ]),
      ),
  };
}
