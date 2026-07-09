/**
 * In-process mock of a Lunatone DALI-2 IoT gateway for tests.
 *
 * Runs a real `Bun.serve` HTTP server implementing the slice of the REST API
 * DaliLunatoneDriver.ts actually uses: `GET /info` (reachability), `GET
 * /device/{id}` (poll), `POST /device/{id}/control` (commands). Fixtures start
 * off at 0% — exactly like real hardware, `dimmable.status` reads back 0
 * whenever `switchable.status` is false, which is what makes the driver's
 * "remember the last brightness while off" logic worth testing.
 */

interface MockFixture {
  id: number;
  switchable: boolean;
  dimmable: number; // 0..100
}

export interface DaliLunatoneMockServer {
  port: number;
  stop: () => void;
  fixture: (id: number) => MockFixture | undefined;
  /** Force a fixture's raw state directly (simulate hardware / another controller). */
  setFixture: (id: number, patch: Partial<Omit<MockFixture, "id">>) => void;
}

function toDevice(f: MockFixture): object {
  return {
    id: f.id,
    name: `Fixture ${f.id}`,
    features: {
      switchable: { status: f.switchable },
      // Real hardware always reports the actual output level — 0 while off.
      dimmable: { status: f.switchable ? f.dimmable : 0 },
    },
  };
}

/** Apply a ControlData body to a fixture. `scene` recall is fixture-defined — the mock ignores it, matching the driver's own "we can't predict the resulting state" comment. */
function applyControl(fixture: MockFixture, body: Record<string, unknown>): void {
  if (typeof body.switchable === "boolean") fixture.switchable = body.switchable;
  if (typeof body.dimmable === "number") {
    fixture.dimmable = body.dimmable;
    fixture.switchable = body.dimmable > 0;
  }
}

async function handleControl(
  fixtures: Map<number, MockFixture>,
  id: number,
  req: Request,
): Promise<Response> {
  const fixture = fixtures.get(id);
  if (!fixture) return new Response("not found", { status: 404 });
  applyControl(fixture, (await req.json()) as Record<string, unknown>);
  return Response.json({ ok: true });
}

function handleGetDevice(fixtures: Map<number, MockFixture>, id: number): Response {
  const fixture = fixtures.get(id);
  return fixture ? Response.json(toDevice(fixture)) : new Response("not found", { status: 404 });
}

export function startDaliLunatoneMock(fixtureIds: number[] = [1]): DaliLunatoneMockServer {
  const fixtures = new Map<number, MockFixture>(
    fixtureIds.map((id) => [id, { id, switchable: false, dimmable: 0 }]),
  );

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/info") {
        return Response.json({ model: "DALI-2 IoT (mock)" });
      }

      const controlMatch = url.pathname.match(/^\/device\/(\d+)\/control$/);
      if (req.method === "POST" && controlMatch) {
        return handleControl(fixtures, Number(controlMatch[1]), req);
      }

      const deviceMatch = url.pathname.match(/^\/device\/(\d+)$/);
      if (req.method === "GET" && deviceMatch) {
        return handleGetDevice(fixtures, Number(deviceMatch[1]));
      }

      return new Response("not found", { status: 404 });
    },
  });

  return {
    port: server.port ?? 0,
    stop: () => server.stop(true),
    fixture: (id) => fixtures.get(id),
    setFixture: (id, patch) => {
      const f = fixtures.get(id);
      if (f) Object.assign(f, patch);
    },
  };
}
