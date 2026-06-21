/**
 * In-process mock of a NETIO smart socket device for tests.
 *
 * Runs a real `Bun.serve` HTTP server that speaks the JSON M2M API exactly as
 * documented in NETIO-M2M-API-Protocol-JSON.pdf. Tests point the driver at
 * `http://127.0.0.1:<mock.port>` — no real hardware needed.
 *
 * Supports:
 *   GET  /netio.json         → returns the current state of all outputs
 *   POST /netio.json         → applies one or more output actions, returns updated state
 *
 * Auth: Basic auth is checked when `opts.username/password` are set (optional).
 *
 * The mock simulates a PowerBOX 4Kx (4 outputs, with metering fields) by default.
 * Outputs start powered OFF. `shortOn`/`shortOff` actions are reflected
 * immediately in state (the timer is not simulated) so assertions stay simple.
 */


interface MockOutput {
  ID: number;
  Name: string;
  State: 0 | 1;
  Action: number;
  Delay: number;
  // metering (simulated)
  Load: number;
  Current: number;
  Energy: number;
}

export interface NetioMockOptions {
  numOutputs?: number;     // default 4
  username?: string;       // if set, Basic auth is required
  password?: string;
  /** Called for every received POST body (useful for asserting actions). */
  onWrite?: (outputs: Array<{ ID: number; Action: number; Delay?: number }>) => void;
}

export interface NetioMockServer {
  port: number;
  stop: () => void;
  /** Current output state (for assertions). */
  state: (outputId: number) => { on: boolean; load: number; current: number; energy: number } | undefined;
  /** Force-set an output state directly (e.g. to simulate an external change). */
  setState: (outputId: number, on: boolean) => void;
  /** All POST bodies received so far. */
  writes: Array<{ ID: number; Action: number; Delay?: number }[]>;
}

/**
 * Creates and starts an in-process HTTP mock server that simulates a NETIO device's JSON M2M API.
 *
 * @param opts - Optional configuration for the mock server (number of outputs, authentication credentials, and write callback)
 * @returns A mock server instance with methods to control and monitor output state
 */
export function startNetioMock(opts: NetioMockOptions = {}): NetioMockServer {
  const numOutputs = opts.numOutputs ?? 4;
  const writes: Array<{ ID: number; Action: number; Delay?: number }[]> = [];

  // Build initial output table.
  const outputs = new Map<number, MockOutput>();
  for (let i = 1; i <= numOutputs; i++) {
    outputs.set(i, {
      ID: i,
      Name: `output_${i}`,
      State: 0,
      Action: 6,          // "ignore" is what the device echoes back
      Delay: 5000,
      Load: 0,
      Current: 0,
      Energy: 0,
    });
  }

  function buildResponse(): object {
    return {
      Agent: {
        Model: "4KF",
        DeviceName: "netio-mock",
        Version: "3.1.3",
        JSONVer: "2.4",
        MAC: "24:A4:2C:AA:BB:CC",
        SerialNumber: "24A42CAABBCC",
        Uptime: 12345,
        NumOutputs: numOutputs,
      },
      Outputs: [...outputs.values()].map((o) => ({
        ID: o.ID,
        Name: o.Name,
        State: o.State,
        Action: 6,           // device always echoes 6 (ignore) in responses
        Delay: o.Delay,
        Load: o.Load,
        Current: o.Current,
        Energy: o.Energy,
      })),
    };
  }

  function applyAction(out: MockOutput, action: number, delay?: number): void {
    switch (action) {
      case 0:  out.State = 0; break;               // off
      case 1:  out.State = 1; break;               // on
      case 2:  out.State = 0; break;               // short-off → ends OFF (simplified)
      case 3:  out.State = 1; break;               // short-on  → ends ON  (simplified)
      case 4:  out.State = out.State === 1 ? 0 : 1; break;  // toggle
      case 5:  break;                               // no change
      // 6 = ignore — used with State tag; handled below
    }
    if (delay !== undefined) out.Delay = delay;
    // Simulated metering: on outputs draw 100W / 435mA.
    out.Load    = out.State === 1 ? 100 : 0;
    out.Current = out.State === 1 ? 435 : 0;
  }

  function checkAuth(req: Request): boolean {
    if (!opts.username) return true;  // no auth required
    const header = req.headers.get("authorization") ?? "";
    const encoded = header.replace(/^Basic\s+/i, "");
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const [u, p] = decoded.split(":");
    return u === opts.username && p === opts.password;
  }

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/netio.json") {
        return new Response("not found", { status: 404 });
      }

      if (!checkAuth(req)) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="netio"' },
        });
      }

      if (req.method === "GET") {
        return Response.json(buildResponse());
      }

      if (req.method === "POST") {
        let body: { Outputs?: Array<{ ID: number; Action?: number; State?: number; Delay?: number }> };
        try {
          const text = await req.text();
          body = text ? (JSON.parse(text) as typeof body) : {};
        } catch {
          return new Response("bad request", { status: 400 });
        }

        const cmds = body.Outputs ?? [];
        const written: { ID: number; Action: number; Delay?: number }[] = [];

        for (const cmd of cmds) {
          const out = outputs.get(cmd.ID);
          if (!out) continue;  // unknown ID — silently skip (device behaviour)

          const action = cmd.Action ?? 6;
          written.push({ ID: cmd.ID, Action: action, Delay: cmd.Delay });

          if (action === 6 && cmd.State !== undefined) {
            // Use the State tag directly (Action=6 → ignore action, use State).
            out.State = cmd.State === 1 ? 1 : 0;
            out.Load    = out.State === 1 ? 100 : 0;
            out.Current = out.State === 1 ? 435 : 0;
          } else {
            applyAction(out, action, cmd.Delay);
          }
        }

        writes.push(written);
        opts.onWrite?.(written);

        return Response.json(buildResponse());
      }

      return new Response("method not allowed", { status: 405 });
    },
  });

  return {
    // Bun types `Server.port` as `number | undefined` (unix sockets have none);
    // this is a TCP HTTP server bound to port 0, so it's always assigned.
    port: server.port ?? 0,
    stop: () => server.stop(true),
    state: (id) => {
      const o = outputs.get(id);
      if (!o) return undefined;
      return { on: o.State === 1, load: o.Load, current: o.Current, energy: o.Energy };
    },
    setState: (id, on) => {
      const o = outputs.get(id);
      if (!o) return;
      o.State = on ? 1 : 0;
      o.Load    = on ? 100 : 0;
      o.Current = on ? 435 : 0;
    },
    writes,
  };
}
