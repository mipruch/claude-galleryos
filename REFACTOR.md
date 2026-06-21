# GalleryOS — Refactor, Tidy-up & Hardening Proposal (v2)

A deep review of the whole codebase (server, UI, `@gallery/types`, `driver-core`,
drivers, tests, monorepo wiring) focused on **simplification, de-duplication,
tighter BE↔FE / communication-object type coupling, test robustness, and design
flaws** — *no new features*. Nothing here changes the architecture you're happy
with (event bus, structured logging, broadcast-on-every-change). It removes
boilerplate, deletes code that does nothing, fixes a few real bugs, and prepares
the structure for the **cron scheduler** and **admin UI** still to come.

---

## 0. How to use this document (READ FIRST — for the implementing agent)

This is a **menu, not a script.** Follow these rules so nothing surprising lands:

1. **One item = one focused change/commit.** Don't batch unrelated items.
2. **Do not change the architecture.** Keep the EventBus, the subprocess-per-
   connection driver model, Redis-as-live-state, and broadcast-to-all. Items that
   *touch* architecture are tagged **[DECIDE]** and must be confirmed with the
   maintainer (Michal) via a question *before* coding — do not just implement them.
3. **Never rename or drop a DB column without an explicit Drizzle migration** and
   maintainer sign-off. Several "unused" columns are intentionally reserved for
   features in `PLAN.md` (scheduler, layouts, versioning). They are listed in §G6
   as *inventory*, **not** as deletion targets.
4. **Preserve behaviour** unless an item explicitly says to change it. Where an
   item fixes a behaviour, it states the exact before/after.
5. **After each item:** run `bun run typecheck`, `bun test` (server),
   `bun run test:ui` (UI), and `bunx fallow` (per CLAUDE.md). All must stay green.
6. **Effort tags:** 🟢 small (<1h) · 🟡 medium · 🔴 large/multi-file.
   **Risk tags:** ⚠️ behaviour-changing · 🧪 needs/deserves a test · [DECIDE] needs a call.
7. If a file/line reference has drifted, **find the named symbol** rather than
   trusting the line number, and re-confirm the issue still exists before editing.

---

## Section A — Communication contracts (the core ask: couple BE↔FE)

Today the same domain concepts are re-declared in **three** parallel type systems
with three different discriminants, mapped by hand:

| Layer | File | Shape | Discriminant example |
|-------|------|-------|----------------------|
| Internal bus | `apps/server/src/core/EventBus.ts` `GalleryEvent` | `{ type, … }` | `device.state.changed` |
| WebSocket wire | `packages/types/src/messages.ts` | `{ event, data }` | `device:state` |
| Driver IPC | `packages/driver-core/src/ipc.ts` | `{ kind, … }` | `state` |

Adding one realtime event currently means editing **four** places (bus union,
wire union, the `toClientMessage` switch, the UI handler map) and a missing arm is
*silently dropped* (`ws.ts` `toClientMessage` `default: return null`).

### A1. 🔴🧪 Move the domain-event catalog into `@gallery/types`
**Problem:** `GalleryEvent` lives in the server, so the UI can't see it and the
wire union (`ServerMessage`) is a hand-kept parallel copy.
**Proposal:** Create `packages/types/src/events.ts` holding the canonical event
catalog (the union currently in `EventBus.ts`). `EventBus.ts` imports it and keeps
only the emitter mechanics. Both the wire mapping (A2) and the UI consume the same
names.
**Guardrails:**
- Keep `EventBus`'s runtime class in the server; only the *types* move.
- Do **not** make `@gallery/types` import server code (it must stay leaf/shared).
- `@gallery/types` must not gain a runtime dependency on anything server-only.
**Acceptance:** server + UI both import event types from `@gallery/types`; no type
duplication of event payloads remains; `bun run typecheck` green.

### A2. 🔴⚠️🧪 Make the bus→wire projection mechanical (no silent drops)
**Problem:** `apps/server/src/api/ws.ts` `toClientMessage()` is a 28-line hand
switch; the `default: return null` means a new bus event silently never reaches
clients, with no compiler help.
**Proposal (pick ONE — [DECIDE] which):**
- **(a) Exhaustive mapping table.** Replace the switch with a `Record<
  GalleryEventType, (e) => ServerMessage | null>` so TypeScript forces every event
  type to declare a projection (explicit `null` to opt out). A new event becomes a
  *compile error* until mapped.
- **(b) Collapse the two unions.** Emit the bus event over the socket as-is,
  renaming the discriminant (`type` → `event`) at the single boundary, and let the
  UI narrow on the same union the server emits. Most payloads are already identical.
**Guardrails:** Preserve the current wire event *names* and payloads exactly
(see the existing `ServerMessage` union) — this is a refactor, not a protocol
change. The de-dup logic in `setupBroadcast` must keep working unchanged.
**Acceptance:** removing an arm/event fails the build; `ws-broadcast.test.ts` and
`ws-command.test.ts` stay green; wire bytes for existing events are byte-identical
(add a test asserting a sample of each).

### A3. 🟢🧪 Shared `ApiError` type — fixes a real, silent bug
**Bug:** `apps/server/src/api/http.ts` `toErrorResponse()` returns
`{ error: <string>, code, details? }`. The UI reads it as an object:
```ts
// apps/ui/src/stores/scenes.ts ~line 85
const body = … as { error?: { message?: string } } | null
const msg = body?.error?.message ?? `${res.status} ${res.statusText}`
```
`error` is a **string**, so `.message` is always `undefined` → the real server
reason (e.g. "scene already running: …") is never shown; the user always sees the
bare status text.
**Proposal:** Add `interface ApiError { error: string; code: string; details?: unknown }`
to `@gallery/types`. Type `http.ts`'s error response as `ApiError`; in the UI add a
shared `readApiError(res)` helper that parses it and use it in `scenes.ts`
`execute()` (and anywhere else that inspects an error body).
**Guardrails:** Don't change the *wire* error shape (it's already `{error,code,
details}`); just type it and read it correctly.
**Acceptance:** a 409 from `/scenes/:id/execute` shows the server's message in the
toast; add a UI test for `readApiError`.

### A4. 🟡🧪 Shared union types for "communication values"
**Problem:** The values that flow across API/WS/DB are loose `string`s declared in
multiple places, so a typo isn't caught and FE/BE can drift:
- `onFailure: "continue" | "abort"` — currently `string` in `SceneActionRecord`
  (`SceneEngine.ts`), `SceneActionInput` (`records.ts`), and the DB column.
- scene execution `status: "running"|"completed"|"failed"|"aborted"|"interrupted"`
  — only partially typed (`SceneExecutionResult.status` is a union; the row + repo
  use `string`).
- execution `source: "userui"|"adminui"|"api"|"scheduler"|"osc"|"tcp"` — free
  string everywhere (the scheduler will add `"scheduler"`).
- `LogLevel` — already a union in `records.ts`; reuse it (the DB column is `string`).
- device `type`, connection `protocol`, mapping `targetType`/`protocol` — free
  strings.
**Proposal:** Define these unions once in `@gallery/types` (e.g.
`OnFailure`, `ExecutionStatus`, `ExecutionSource`, `DeviceType`, `ConnectionProtocol`)
and use them in: the Drizzle `$type<…>()` on the column, the engine/record types,
the route parsers, and the UI. This is the highest-leverage "couple the values"
change and directly de-risks the scheduler/admin UI.
**Guardrails:** `$type<Union>()` is a *type-only* annotation — it does **not**
require a migration (column stays `varchar`). Keep accepting unknown strings
defensively at the DB read boundary (don't crash on legacy rows); validate on write.
**Acceptance:** changing an `onFailure` literal in the engine and a mismatching one
in the route is a compile error.

### A5. 🔴 Collapse the driver IPC duplication
**Problem:** `packages/driver-core/src/ipc.ts` re-encodes every `IDeviceDriver`
method by hand. "executeCommand" is spelled in 4 spots: the interface
(`IDeviceDriver.ts`), the `CoreToDriverMessage` request arm + `reply`
(`ipc.ts`), the `DriverHost` proxy (`DriverHost.ts`), and the `runtime.ts`
dispatch `case`.
**Proposal:** Derive the request/reply protocol from a single method table keyed by
method name (`{ executeCommand: {params; result}, readState: {…}, … }`), so the
request union, the `DriverHost` proxy, and the `runtime.ts` switch are generated
from one source. Keep fire-and-forget lifecycle events (`connected`, `state`, …) as
explicit messages — only the request/reply methods get derived.
**Guardrails:** This is internal plumbing; the IPC *wire* (Bun structured-clone
messages) must stay compatible. Keep `kind` as the discriminant (the comment in
`ipc.ts` explains why). Do this only when you're already touching drivers — it's
contained but invasive. Drivers themselves must not need edits.
**Acceptance:** `driver-host.test.ts` + `device-manager.test.ts` (real subprocess)
stay green; adding a hypothetical driver method touches the interface + table only.

### A6. 🔴 [DECIDE] Typed API client + route manifest (admin-UI prep)
**Problem:** Every store hand-rolls `fetch`, `fetchJson`, error handling and URL
building. The admin UI will add CRUD for rooms, connections, devices, scenes,
schedules, mappings, layouts, logs — dozens more hand-written calls. There is no
typed link between a route's path and its request/response DTO.
**Proposal (needs a design call before coding):** Introduce a small typed API
client in `apps/ui/src/lib/api/` whose methods are typed against `@gallery/types`
DTOs (`DeviceDTO`, `SceneWithActionsDTO`, `SceneCreateInput`, …). Optionally back it
with a shared route-contract object in `@gallery/types` (method + path + input +
output) the server route map also references, so FE and BE share one source.
**Guardrails:** Do not adopt a heavy framework (tRPC/OpenAPI codegen) without
sign-off — a hand-written typed client is likely enough and matches the project's
"no hidden magic" ethos. Land this **before** building admin UI, not retrofitted
after.
**Acceptance:** stores call `api.scenes.list()` etc.; no raw `fetch` in stores.

---

## Section B — Dead code & leftover scaffolding (all 🟢, low risk)

### B1. `device:subscribe` / `device:unsubscribe` WS path is dead
`messages.ts` (`ClientMessage` arms) + `ws.ts` `onSubscribe`/`onUnsubscribe`
subscribe a socket to a `device:${id}` topic **nothing ever publishes to** (all
broadcasts go to the single `events` topic in `setupBroadcast`). The UI never sends
these. **Remove** both client-message variants and both handlers (and their entries
in `CLIENT_HANDLERS`).
**Guardrail:** keep `device:state:patch` — that one *is* used (`LightFaderWidget`
→ store `patchDeviceState`).

### B2. `scene.execute.aborted` event is never emitted
Defined in `GalleryEvent` (`EventBus.ts`) but the engine emits
`scene.execute.failed` for aborts (`SceneEngine.runPlan`). Remove the unused arm.
*(If you'd rather surface aborts distinctly on the wire, that's a feature — out of
scope here.)*

### B3. `stores/counter.ts` is Vite scaffolding
`useCounterStore` is referenced nowhere. Delete the file.

### B4. Duplicate `watch(...)` block in `App.vue`
`apps/ui/src/App.vue` registers the **identical** `() => route.params.roomId`
watcher twice (two back-to-back `watch(...)` calls with the same body). Delete one.

### B5. `EventBus.once()` is unused
No call sites. Either remove it or keep deliberately (it's tiny) — note in the PR
which you chose. Low priority.

### B6. 🟡 Discovery path is plumbed but unreachable
`DriverHost.discoverEndpoints()` + the `runtime.ts` `discoverEndpoints` case exist,
but **no** `DeviceManager` method or route ever calls them (grep confirms). Either
wire a `POST /api/v1/connections/:id/discover` route + `DeviceManager.discover()`,
or add a clear `// NOT YET EXPOSED` note so it isn't mistaken for working. **[DECIDE]**
which (exposing it is arguably a small feature).

---

## Section C — Bugs & incorrect logic

### C1. 🟢⚠️🧪 Watchdog swallows connection-health errors silently
`apps/server/src/core/Watchdog.ts` `checkOneConnection()` has the error log
**commented out** (the `catch (err) { // this.log.warn(...) return; }` block), so a
connection whose health check throws every tick produces *zero* signal, and `err`
is an unused binding. **Restore the `log.warn`** (or intentionally `log.debug`) and
use `err`. This is also why C-tests didn't catch it — see F4.
**Acceptance:** a throwing `healthCheckConnection` produces a log line; add an
assertion (spy on logger) so it can't silently regress again.

### C2. 🟡 Endpoint-check timers leak past `stop()`
`Watchdog.scheduleEndpointChecks()` schedules N `setTimeout`s spread across the
interval but **never tracks them**, so `stop()` can't cancel in-flight endpoint
checks — they fire after the watchdog is stopped (matters in tests and on
shutdown). Track the timer ids (or an `AbortController`) and clear them in `stop()`.

### C3. 🟡⚠️ Split ownership of live status (two writers, can disagree)
Both `DeviceManager` and `Watchdog` write `connection:{id}:status` **and** emit
`connection.connected/disconnected`; likewise both write `device:{id}:status`
(DeviceManager via `markDevices` on connect/disconnect, Watchdog layer-2 via
endpoint checks). They can briefly disagree and double-emit. **Proposal:** pick one
authority per fact — e.g. DeviceManager owns the *transport* transition
(connection up/down on socket events); Watchdog owns *liveness re-confirmation* and
only emits on a real change. Document the ownership in both files. **[DECIDE]** the
exact split before changing emissions — this is behaviour-adjacent.

### C4. 🟡⚠️ PUT handlers forward the raw body to the DB (mass-assignment)
`rooms.ts`, `devices.ts`, `iframes.ts`, and `connections.ts` PUT handlers pass the
entire request `body` into `repo.update(id, body)`, which does
`.set({ ...values, updatedAt })`. A client can attempt to set columns it shouldn't
(`id`, `createdAt`, `createdBy`, `connectionId`, …). The POST handlers carefully
allow-list fields; the PUTs don't (scenes PUT is the one exception that allow-lists).
**Proposal:** allow-list updatable fields per resource (mirror the POST handlers, or
a shared `pick()`), matching scenes' approach.
**Guardrail:** preserve which fields are legitimately editable; don't silently drop
fields the UI relies on (diff against current UI usage).

### C5. 🟢 `optimistic "all online on connect"` can briefly lie
`DeviceManager.markDevices(connectionId, true)` flips *every* endpoint to online the
instant the connection's socket opens, before any endpoint probe. Watchdog layer-2
corrects later, but the UI shows green prematurely. At minimum add a comment; or gate
the per-device "online" on the first successful endpoint check for drivers that
support it. **[DECIDE]** (low priority; tied to C3).

### C6. 🟡 `scenes.test.ts` mutates shared engine fake across tests
`engineBehavior.start`/`.dry` are reassigned inside tests and never restored, so the
suite is order-dependent (the happy-path `202` test only passes because it runs
before the throwing ones). Reset `engineBehavior` in a `beforeEach`. (Test-only;
no product impact, but it masks regressions.)

---

## Section D — Types: useless / too loose / duplicated

### D1. 🟢 Dead manifest fields: `reversible`, `estimatedDurationMs`
`CommandDefinition` (`driver-core/src/types.ts`) carries `reversible` and
`estimatedDurationMs`; **nothing reads them** (rollback/choreography were dropped per
PLAN §2). Every manifest fills `reversible` for nothing. **Remove** both fields from
the type and the manifests, **or** add a one-line `// reserved for rollback (PLAN
§2, not implemented)` if you want to keep them. **[DECIDE]** keep-vs-remove.

### D2. 🟢 Manifest JSON-Schemas are declared but never enforced
`connectionSchema` / `addressSchema` / `paramsSchema` exist on every manifest and
Ajv is in the stated stack, but **no code validates against them**. Device create
only checks the `subtype` string is known (`devices.ts`); command `params` and
device `address` are never validated. This is the biggest "types that promise more
than the code delivers" surface. See G4 for the structural fix; at minimum, note the
gap in the driver-authoring docs so authors know schemas are currently descriptive.

### D3. 🟢 Pick one JSON-Schema type
`driver-core` defines a custom `JsonSchema` (`types.ts`) while
`driver-template/src/manifest.ts` imports `JSONSchema7` from `@types/json-schema`
(and the README uses `JSONSchema7`). Standardise on **one** (recommend the custom
`JsonSchema` since it's dependency-free and already used by real drivers) and update
the template + README to match.

### D4. 🟢 Tighten loose ack payloads
In `messages.ts`: `device:command:ack.success` is `boolean | undefined` even though
the contract guarantees it's always present (PLAN §2.6); `scene:execute:ack` has
*every* field optional. Make `success` required and split `scene:execute:ack` into a
proper success/error discriminated shape, so the UI stops doing defensive
`=== false` / `!== false` checks (`devices.ts` `onCommandAck`).
**Guardrail:** keep the server actually sending the now-required fields (it does for
`device:command:ack`; verify `scene:execute:ack`).

### D5. 🟢 `DeviceStatus` / `ConnectionStatus` are identical aliases
Both are bare aliases of `LiveStatus` (`live.ts`). Fine for documentation, but be
aware they're structurally identical — if you add a field to one "for connections"
it silently applies to devices too. Leave as-is unless they genuinely diverge; noted
so nobody assumes they're separate.

---

## Section E — Duplication (logic)

### E1. 🟢 Per-route `id` helper duplicated 6×
`const id = (req) => (req.params as { id: string }).id` appears in `devices.ts`,
`rooms.ts`, `connections.ts`, `iframes.ts`, `scenes.ts` (and inline in `drivers.ts`).
Hoist one `paramId(req)` into `http.ts`.

### E2. 🟢 `errMsg` reimplemented everywhere
`err instanceof Error ? err.message : String(err)` is duplicated in `DriverHost.ts`,
`runtime.ts`, `ws.ts`, `DeviceManager.ts`, `SceneEngine.ts` (×5), and every UI store.
Export one `errMsg()` from a shared util (server `lib/`; the UI can have its own tiny
copy or import from `@gallery/types` if placed there carefully).

### E3. 🟢 UI store plumbing duplicated verbatim
`wsUrl()`, `parseEnvelope()`, and `fetchJson()` are copy-pasted between
`stores/devices.ts` and `stores/connections.ts`, plus the identical
`handlers: { [E in ServerEvent]?: … }` map + `handleMessage` cast. Centralise into
`lib/http.ts` / `lib/ws.ts`. (Largely subsumed by E4.)

### E4. 🟡 [DECIDE] Single shared WebSocket (currently TWO sockets)
README/PLAN say "single WebSocket connection," but the **devices store**
(`stores/devices.ts`) and the **connections store** (`stores/connections.ts`) each
call `useWebSocket(wsUrl())`, opened independently in `App.vue` and
`ConnectionStatus.vue`. Every broadcast is delivered to both sockets; each store
ignores the other's events. **Proposal:** one `useRealtime()` composable owning a
single socket, fanning parsed envelopes to registered per-event handlers; stores
subscribe to it. This both fixes the flaw and removes most of E3. **[DECIDE]**
because it changes store lifecycle/ownership (who opens/closes the socket) — confirm
the composable owns connect/disconnect, and App mounts it once.
**Acceptance:** exactly one `/ws` connection in the network panel; devices + scenes
+ connections all update live.

### E5. 🟢 `normalize()` + haystack search duplicated
`lib/devices.ts` and `lib/scenes.ts` each define `normalize()` and the same
multi-term AND-search pattern. Extract a generic `normalize()` and
`matchesAllTerms(haystack, query)` util.

---

## Section F — Tests (robustness assessment)

**Overall:** server tests are genuinely behavioural and better than typical "mirror
the implementation" tests — `device-manager.test.ts` and `driver-host.test.ts` spin
a **real subprocess** against mock devices; `scene-engine.test.ts` covers ordering,
`on_failure`, locks, pre-flight, composition (cycles, missing, reference-sharing),
dry-run; `ws-broadcast`/`ws-command` cover the de-dup and ack contracts; the Watchdog
suite covers transitions + stagger. Pure UI helpers (`devices.spec`, `scenes.spec`,
`commands.spec`) are well covered. The gaps below are about *what isn't* tested.

### F1. 🔴🧪 The UI's optimistic-command / ack / revert machinery is untested
The riskiest FE code — `sendCommand`, `onCommandAck`, `snapshotState`/`applyRevert`,
the per-device FIFO `pending` queue, and the "drop socket → resolve pending as
failed" watcher in `stores/devices.ts` — has **zero** tests. `devices-store.spec.ts`
only exercises room-scope computeds. **Proposal:** add a store test that fakes the
socket and asserts: optimistic merge → ack success adopts authoritative state; ack
failure reverts the snapshot + toasts; FIFO ordering across two in-flight commands;
disconnect resolves all pending as failed without reverting. This is where a real
regression would hide.

### F2. 🟡🧪 No test for `device:state:patch` round-trip
`onStatePatch` (server) + `patchDeviceState` (store) — the "remember brightness while
off" path, including the DALI `shouldPreserveBrightness` merge (`redis/state.ts`) —
isn't covered. Add a hermetic test for `mergeDeviceState`/`shouldPreserveBrightness`
(pure function, trivial to test) and ideally a WS patch round-trip.

### F3. 🟡 Integration test never runs by default
`test/integration/*.integration.test.ts` is gated behind `GALLERY_INTEGRATION=1` and
there's **no CI** (see G1), so the real Postgres/Redis/HTTP/WS path is effectively
never exercised automatically. Wire it into CI as a dedicated job with infra
(docker-compose) so it actually runs (see G1).

### F4. 🟢🧪 Some assertions are vacuous and hid a real bug
`watchdog.test.ts` "swallows healthCheck errors without crashing" asserts only
`expect(watchdog).toBeDefined()` — always true — which is precisely why the
commented-out error log (C1) went unnoticed. Strengthen it to assert the error is
*logged/surfaced* (spy on the logger). Audit for similar "did not throw" assertions.

### F5. 🟢 UI tests bypass the shared types via `as unknown as`
`devices.spec.ts`, `scenes.spec.ts`, `commands.spec.ts`, `devices-store.spec.ts`
build fixtures as `… as unknown as DeviceRecord/SceneDTO/RoomDTO`. If a DTO field
changes, these tests won't catch it. Add small typed fixture factories (no `unknown`
cast) so the tests are coupled to the real `@gallery/types` shapes.

### F6. 🟢 Test files aren't type-checked (see G2) and there's no unified test command
`bun run typecheck`'s `include` is `src/**` only, and `bun test` strips types — so a
type error *in a test* is never caught. And `bun run test` runs only server tests;
UI tests need `bun run test:ui`. Add `test/**` to the typecheck include (or a
`tsconfig` for tests) and a root `test:all` that runs both runners.

---

## Section G — Architecture & monorepo structure (incl. scheduler + admin-UI readiness)

### G1. 🔴 No CI at all
There is no `.github/workflows`. The good tests, typecheck, lint, and fallow checks
run only if someone remembers locally. **Proposal:** add a CI workflow that runs, on
PR: `bun install`, `bun run typecheck`, `bun test`, `bun run test:ui`, lint, and
`bunx fallow`; plus a **separate job** with docker-compose Postgres+Redis that runs
the `GALLERY_INTEGRATION=1` suite (F3). This is the single biggest safety
investment before the codebase grows with the scheduler + admin UI.

### G2. 🟡 `tsconfig` doesn't type-check tests; `paths` is incomplete & inconsistent
- Root `tsconfig.json` `include` is `apps/*/src/**` + driver `src/**` — it omits
  `**/test/**` and `packages/types/src/**` (the latter is only pulled in
  transitively). Tests are therefore never type-checked (F6).
- `paths` lists only 3 of the 6 drivers (`driver-core`, `driver-pjlink`,
  `driver-tcp-generic`) and not `@gallery/types`; the rest resolve via bun's
  node_modules symlinks. **Either** rely entirely on workspace symlinks and drop the
  partial `paths`, **or** list all packages — don't half-do it.
**Guardrail:** verify `bun run typecheck` stays green after either choice (the
symlink resolution already works at runtime).

### G3. 🟢 `.fallowrc.json` has a stale path + missing workspace
- `ignorePatterns` references `apps/server/src/db/schema.ts`, but the schema **moved**
  to `packages/types/src/schema.ts`. Update the ignore to the new path.
- `workspaces.packages` omits `packages/types`, so fallow may not scan the shared
  contracts package. Add it (root `package.json` already lists it as a workspace).

### G4. 🟡 [DECIDE] No shared validation layer (Ajv unused)
Every route hand-codes `requireFields` + `String(body.x)` + `asObject` coercion, and
PUT handlers skip it entirely (C4). With the admin UI submitting complex forms
(scene actions, schedule cron + timezone, layout config) and JSON-Schemas already on
every manifest (D2), the ad-hoc approach won't scale and is inconsistent. **Proposal
(needs a call):** adopt one validation approach — either wire **Ajv** against the
manifest schemas (closing D2's loop for driver config/params/address) and a small set
of hand-written schemas for core resources, or a lightweight validator. Keep it
*thin*; don't introduce a heavy framework. Land before the admin UI's forms.

### G5. 🟢 Driver tests live in two different places
Some drivers test inside their package (`packages/drivers/driver-bss/test/`,
`driver-dali-foxtron`, `driver-netio`, `driver-template`); others are tested from the
server (`apps/server/test/drivers/pjlink.test.ts`, `tcp-generic`, `dali-lunatone`).
A new driver author won't know where tests go. **Proposal:** standardise — co-locate
each driver's unit tests in its own package; keep only cross-cutting subprocess/IPC
tests in the server. Document the convention in the driver-authoring guide.

### G6. 🟢 Schema inventory: live vs dormant (DO NOT DELETE — reference)
For the implementing agent's awareness (so "unused" tables aren't "cleaned up"):
- **Live:** `rooms`, `connections`, `devices`, `scenes`, `scene_actions`,
  `scene_executions`, `iframes`, `logs`.
- **Reserved for PLAN features (keep):** `scheduled_jobs` (cron scheduler, P3),
  `input_mappings` (TCP ingress, P4), `ui_layouts` (admin/user layouts), `config`
  (runtime settings), `scene_versions` (versioning, deferred).
- **Dormant columns (keep, but know they're unused today):** `scenes.variables`,
  `scenes.version`, `scene_executions.pre_state`, `created_by` on several tables
  (auth, P6). `appConfig.input.{oscPort,tcpPort}` (ingress).
Action: none beyond a short "reserved" note where helpful. **Do not** drop these.

### G7. 🟡 [DECIDE] `apps/ui` vs `packages/ui` — resolve before admin UI
README §3 depicts **both** an `apps/ui` app and a shared `packages/ui` component
library and a single Vue app serving `/admin/**` + `/app/**`. Reality: a single
`apps/ui` with its own `components/ui`, no `packages/ui`, user-panel only. Before
building the admin UI, **decide and write down**: (a) one `apps/ui` with route-based
admin/user layouts (simplest, matches current trajectory), vs (b) split apps sharing
`packages/ui`. Update README to match the decision so the next builder isn't misled.

### G8. 🟢 Scheduler-readiness notes (for when P3 lands)
The pieces are mostly in place — `scheduled_jobs` table exists and
`SceneEngine.executeScene(sceneId, "scheduler")` already takes a `source`. When
building it, follow the **existing precedent**: schedule CRUD routes call a
`Scheduler` core module **directly** (exactly as connections routes call
`DeviceManager`), not via the EventBus — the bus is for state *broadcast*, not RPC.
Two specifics to verify early: (1) the README's `Temporal`-based timezone math
assumes `Temporal` is available in the Bun version pinned — confirm before relying on
it; (2) reuse the `ExecutionSource` union from A4 so `"scheduler"` is a typed source.
This is a note, not a task.

### G9. 🟢 [DECIDE] Broadcast has no topic separation (forward-looking, for auth/admin)
Every client is subscribed to the single `events` topic and receives *everything*
(incl. `driver:error`, scene internals). Fine today (no auth, user panel only), but
when the admin UI + auth (P6) arrive, the user panel probably shouldn't receive
admin-only events. Note now; design topic/role separation when auth lands. No action
yet.

---

## Section H — Misplaced logic / design smells

### H1. 🟡 Driver-specific logic baked into the generic Redis store
`redis/state.ts` `shouldPreserveBrightness`/`mergeDeviceState` hardcodes DALI
semantics ("brightness 0 when off → keep last level") into the **generic** live-state
store. That's driver behaviour leaking into core. **Proposal:** move it into the DALI
drivers (emit the intended state) or express it as a per-endpoint-type state policy
the store consults, so the core store stays dumb. **[DECIDE]** placement (driver vs
policy) — both are reasonable; don't just delete the behaviour (it's intentional UX).

### H2. 🟢 `ws.ts` micro-opt comment
`onDeviceCommand` uses `Object.assign({}, data.params)` with a comment justifying
"avoid a `??` branch". Replace with `{ ...(data.params ?? {}) }` — clearer, same
effect.

### H3. 🟢 `withRuntime` type honesty (connections route)
`connections.ts` `withRuntime` spreads a `Connection` (Date fields) but the value is
treated as `ConnectionWithRuntime` (string dates); it's only correct after
`Response.json`. A typed `json<T>()` helper (I1) makes the DTO boundary explicit.

---

## Section I — Smaller nits

- **I1.** 🟢 Add a typed `json<T>(data: T, status?)` helper in `http.ts` so each
  route asserts the **DTO** type it returns (today handlers return raw rows and rely
  on `Response.json` with no type check). Improves end-to-end coupling cheaply.
- **I2.** 🟢 `config.ts` has a stray indented blank line (cosmetic) and `appConfig.input`
  is unused until ingress (expected; leave).
- **I3.** 🟢 The three discriminants (`type`/`event`/`kind`) are intentional but add
  cognitive load; once A1/A2 land, document the boundary in one place (the `ipc.ts`
  header already explains `kind`).
- **I4.** 🟢 `EventBus` emits to both the typed topic and a `WILDCARD`; both the audit
  logger and the broadcast bridge attach via `onAny`. Fine, but note there are two
  wildcard listeners on every event for observability.

---

## Section J — Documentation drift (hurts "understanding the code")

- **J1.** README §2/§4 still describe **Socket.io**; the server uses native
  `Bun.serve` WebSockets.
- **J2.** README §7.4 (Scheduler) and §13 / PLAN P4 (TCP ingress, `InputMapper`)
  read as implemented, but `Scheduler.ts`, `TcpInputServer.ts`, `InputMapper.ts`, and
  the schedules/mappings routes **don't exist**. PLAN marks them `[ ]`; align README.
- **J3.** README §3 shows `packages/ui` + an admin portal that don't exist yet
  (see G7); and references `scene_versions`/rollback/auth as if present (deferred per
  PLAN). Add "planned / not implemented" markers so the README can be trusted.
- **J4.** Per CLAUDE.md, README + PLAN are meant to be updated as features land —
  fold these corrections in as you touch each area.

---

## Suggested sequencing

1. **Safety net first:** G1 (CI) + F6/G2 (typecheck tests) + G3 (fallow fixes). Now
   every later change is guarded.
2. **Quick wins / bug fixes:** A3 (ApiError bug), C1 (watchdog log), C4 (PUT
   allow-list), B1–B5 (dead code), E1/E2/E5 (dedupe), C6/F4 (test hygiene).
3. **FE consolidation:** E4 (single socket) + E3 (shared plumbing), then F1 (test the
   optimistic machinery you just centralised).
4. **Contract coupling:** A4 (shared unions) → A1 (event catalog) → A2 (mechanical
   mapping) → D4 (tighten acks).
5. **Driver internals:** A5 (IPC derivation), D1/D3 (manifest cleanup), G5 (test
   location), H1 (DALI logic placement).
6. **Admin-UI / scheduler prep (each [DECIDE] first):** A6 (API client/route
   manifest), G4 (validation), G7 (apps/ui vs packages/ui), then build.

Everything here keeps the event/log/broadcast architecture intact — it makes adding
a value or an event a one-/two-file change instead of four, deletes code that does
nothing, fixes a handful of real bugs, and puts a safety net (CI + the missing tests)
under the codebase before it grows.
