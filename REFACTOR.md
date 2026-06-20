# GalleryOS — Refactor & Tidy-up Proposal

A review of the current codebase (server + UI + shared packages) focused on
**simplification, de-duplication, tighter BE↔FE type coupling, and design flaws**
— no new features. Nothing here changes the architecture you're happy with
(event-based, log-based, broadcast-on-every-change); it removes boilerplate and
spaghetti *inside* that architecture.

Each item has a concrete location and a proposed change. Items are grouped and
roughly ordered by impact. Effort tags: 🟢 small · 🟡 medium · 🔴 large.

---

## 1. Unify the three "communication contracts" (the big one)

Right now there are **three parallel, hand-mapped message type systems** for what
is largely the same set of domain events:

| Layer | File | Shape | Discriminant |
|-------|------|-------|--------------|
| Internal bus | `apps/server/src/core/EventBus.ts` `GalleryEvent` | `{ type, … }` | `type` (`device.state.changed`) |
| WebSocket wire | `packages/types/src/messages.ts` `ServerMessage`/`ClientMessage` | `{ event, data }` | `event` (`device:state`) |
| Driver IPC | `packages/driver-core/src/ipc.ts` `CoreToDriverMessage`/`DriverToCoreMessage` | `{ kind, … }` | `kind` (`state`) |

The bridge between bus and wire is a **hand-written switch** in
`apps/server/src/api/ws.ts:26-54` (`toClientMessage`). Adding one new realtime
event today means editing **four** places: `GalleryEvent`, `ServerMessage`, the
`toClientMessage` mapping, and the UI handler map. Easy to forget one; the type
system won't catch a missing mapping arm (the `default: return null` swallows it).

### 1.1 🔴 Move the domain-event catalog into `@gallery/types`
`GalleryEvent` lives in the server, so the FE can't see it and the wire types
have to be re-declared by hand. Move the canonical event catalog into
`@gallery/types` so the bus and the wire derive from **one** source. The server
can still wrap it in its `EventBus`; the UI imports the same names.

### 1.2 🟡 Make the bus→wire mapping mechanical instead of a switch
Two viable directions (pick one):
- **Derive the wire event name** from the bus event name with a single rule
  (`device.state.changed → device:state`) + a typed table, so the compiler forces
  every bus event to declare its wire projection (or explicitly opt out). A
  missing mapping becomes a *type error*, not a silently-dropped `null`.
- Or **collapse the two** entirely: broadcast the bus event over the socket as-is
  (rename discriminant once at the boundary). The FE then narrows on the same
  union the server emits.

Net goal: **adding a realtime event touches 2 places (shared catalog + UI
handler), not 4.**

### 1.3 🟡 Decide field parity deliberately, in one place
The mapping silently drops fields: `device.online`/`device.offline` carry
`connectionId` on the bus (`EventBus.ts:18-19`) but not on the wire
(`messages.ts:29-30`); `connection.error` and `system.driver.crashed` both fold
into the wire `driver:error`. That's probably fine — but it's currently implicit
in the switch. With a derived mapping it becomes explicit and reviewable.

---

## 2. Collapse the driver IPC duplication

`packages/driver-core/src/ipc.ts` re-encodes, by hand, every method of
`IDeviceDriver` (`IDeviceDriver.ts`) plus its emitted events. The same operation
("executeCommand") is spelled out in **four** spots:

1. `IDeviceDriver.executeCommand(...)` (the interface)
2. `CoreToDriverMessage` `{ kind: "executeCommand", … }` + the `reply` message
3. `DriverHost.executeCommand(...)` proxy (`DriverHost.ts:141`)
4. `runtime.ts` `case "executeCommand":` (`runtime.ts:141`)

### 2.1 🔴 Derive the request/reply protocol from `IDeviceDriver`
Introduce a typed request helper keyed by method name so the `CoreToDriverMessage`
request arms, the `DriverHost` proxy, and the `runtime.ts` dispatch are generated
from one method table (`{ executeCommand: { params, result }, readState: {…} }`).
Adding a driver method then means editing the interface + one table entry, not
four files. (Lifecycle/fire-and-forget events stay as-is.)

### 2.2 🟢 Consolidate the duplicated `errMsg` helper
`err instanceof Error ? err.message : String(err)` is re-implemented in
`DriverHost.ts:335`, `runtime.ts:168`, `ws.ts:232`, `DeviceManager.ts` (inline),
`SceneEngine.ts` (inline, ×5), and every UI store. Export one `errMsg()` (e.g.
from `@gallery/types` or a server `util.ts`) and use it everywhere.

---

## 3. Shared API error type — fixes a real bug

`apps/server/src/api/http.ts:40-53` returns errors as `{ error: <string>, code,
details? }`. But the UI reads the message as if `error` were an object:

```ts
// apps/ui/src/stores/scenes.ts:85-86
const body = … as { error?: { message?: string } } | null
const msg = body?.error?.message ?? `${res.status} ${res.statusText}`
```

`error` is a **string**, so `.message` is always `undefined` → the real
server-side reason (e.g. "scene already running") is silently dropped and the
user always sees the generic status text. This is exactly the kind of
BE/FE-coupling gap you want gone.

### 3.1 🟢 Define `ApiError` in `@gallery/types` and use it on both ends
`interface ApiError { error: string; code: string; details?: unknown }`. Have
`http.ts` return it and the UI parse it. Fixes the scenes-store bug and prevents
the next one. (Other UI fetch helpers just throw `${status} ${statusText}` and
never read the JSON body at all — they'd benefit too.)

---

## 4. Dead code & leftover scaffolding

### 4.1 🟢 `device:subscribe` / `device:unsubscribe` are dead
The client events (`messages.ts:54-55`) and their handlers
(`ws.ts:141-155`, `onSubscribe`/`onUnsubscribe`) subscribe a socket to a
`device:${id}` topic that **nothing ever publishes to** — all broadcasts go to the
single `events` topic (`ws.ts:227`). The UI never sends these messages either.
Remove the two client-message variants and both handlers.

### 4.2 🟢 `scene.execute.aborted` is never emitted
Defined in `GalleryEvent` (`EventBus.ts:29`) but the engine emits
`scene.execute.failed` for aborts (`SceneEngine.ts:364`); nothing emits or maps
`aborted`. Remove it (or wire it if you actually want a distinct "aborted" wire
event).

### 4.3 🟢 `stores/counter.ts` is Vite scaffolding
`useCounterStore` is referenced nowhere. Delete the file.

### 4.4 🟢 Duplicate `watch(...)` in `App.vue`
`apps/ui/src/App.vue:25-29` and `:33-37` register the **identical** `roomId`
watcher twice. Delete one (copy-paste slip).

### 4.5 🟢 `EventBus.once()` is unused
`EventBus.ts:66-68` — no call sites. Drop it (or keep intentionally; it's tiny).

### 4.6 🟡 Discovery path is plumbed but unwired
`DriverHost.discoverEndpoints()` (`DriverHost.ts:167`) + `runtime.ts:153` exist,
but no `DeviceManager` method or API route ever calls them — discovery is
currently unreachable. Either wire a route (`POST /connections/:id/discover`) or
mark it clearly as not-yet-exposed so it isn't mistaken for working.

---

## 5. "Defined but unused" types/fields (validation gap)

### 5.1 🟡 Manifest JSON-Schemas are never enforced
Every manifest carries `connectionSchema`, `addressSchema`, `paramsSchema`
(`driver-core/src/types.ts`), and Ajv is in the stated stack — but **nothing
validates against them**. Device create only checks the subtype *string* is known
(`devices.ts:47-54`); command `params` and device `address` are never validated.
Either start validating (closes the loop these schemas were built for) or
acknowledge they're descriptive-only for now. This is the single biggest
"types that promise more than the code delivers" surface.

### 5.2 🟢 `reversible` / `estimatedDurationMs` are dead fields
`CommandDefinition.reversible` and `estimatedDurationMs` (`types.ts:71-73`) are
never read anywhere (rollback was dropped per PLAN §2). They're filled in by every
manifest for nothing. Remove until rollback/choreography actually use them.

### 5.3 🟢 Pick one JSON-Schema type
`driver-core` defines its own `JsonSchema` (`types.ts:25-58`) while
`driver-template/src/manifest.ts` imports `JSONSchema7` from `@types/json-schema`
(and the README uses `JSONSchema7` too). Standardize on one — either commit to the
custom `JsonSchema` everywhere or to `@types/json-schema` everywhere.

### 5.4 🟢 Loosely-typed ack payloads
`messages.ts`: `device:command:ack.success` is `boolean | undefined` even though
the contract (PLAN §2.6) guarantees it's always present; `scene:execute:ack` has
*every* field optional. Tighten these into proper discriminated success/error
shapes so the UI doesn't have to defensively check `=== false` / `!== false`
(`devices.ts:230-242`).

---

## 6. Frontend duplication & the two-socket flaw

### 6.1 🔴 There are TWO WebSocket connections, not one
The README/PLAN say "single WebSocket connection," but the **devices store**
(`stores/devices.ts:151`) and the **connections store**
(`stores/connections.ts:47`) each call `useWebSocket(wsUrl())` and each get their
own `/ws` socket (opened in `App.vue` `onMounted` and `ConnectionStatus.vue`
`onMounted` respectively). Every broadcast is delivered twice; each store ignores
the other's events. Extract a single `useRealtime()` composable that owns one
socket and fans events out to subscribers. This also removes most of the
duplication in 6.2.

### 6.2 🟢 Verbatim-duplicated store plumbing
`wsUrl()`, `parseEnvelope()`, and `fetchJson()` are **copy-pasted** between
`stores/devices.ts` and `stores/connections.ts` (lines 43/386/380 vs 28/182/175),
along with the identical `handlers: { [E in ServerEvent]?: … }` map +
`handleMessage` cast. Centralize into `lib/ws.ts` / `lib/http.ts` (falls out of
6.1 naturally).

### 6.3 🟢 Duplicated search/normalize helpers
`normalize()` + the haystack-search pattern are duplicated in
`lib/devices.ts:147-186` and `lib/scenes.ts:103-129`. Extract a generic
`normalize()` and a small `matchesAllTerms(haystack, query)` util.

### 6.4 🟢 Scenes store reads the wrong error shape
Same bug as §3 — fix as part of adopting `ApiError`.

---

## 7. Logic that doesn't sit in the right place

### 7.1 🟡 DALI-specific logic baked into the generic Redis store
`redis/state.ts:33-49` (`shouldPreserveBrightness` / `mergeDeviceState`) hardcodes
"DALI lights report brightness:0 when off, keep the last level" into the
**generic** live-state store. Driver-specific behavior leaking into core state.
Move it to the DALI drivers (emit the desired state) or express it as a per-
endpoint-type state policy, so the core store stays dumb.

### 7.2 🟡 `markDevices` fans out one event per device per connection flap
`DeviceManager.markDevices` (`DeviceManager.ts:242-256`) emits a `device.online`/
`device.offline` for *every* endpoint each time a connection connects/disconnects.
A flapping 20-endpoint gateway = 20 events per transition, on top of the
connection-level event the UI already shows. Consider deriving per-device status
from connection status on the FE, or batching, to cut broadcast noise.

### 7.3 🟢 Optimistic "all online on connect" can lie briefly
Same method sets every device `online: true` the instant the *connection* opens,
before any endpoint check. Watchdog layer-2 corrects it later, but the UI shows
green prematurely. Worth a comment at least, or gate on the first health check.

---

## 8. Smaller simplifications / nits

- 🟢 `ws.ts:130` `Object.assign({}, data.params)` with a comment justifying
  avoiding `?? ` — just write `{ ...(data.params ?? {}) }`; it's clearer.
- 🟢 Per-route `const id = (req) => (req.params as { id: string }).id` is repeated
  in every route file (`devices.ts:26`, `connections.ts:22`, `scenes.ts:69`, …).
  Hoist one helper into `http.ts`.
- 🟢 `connections.ts:25` `withRuntime` spreads a `Connection` (Date fields) but is
  typed as returning `ConnectionWithRuntime` (string dates). It's only honest
  after `Response.json`. A typed `json<T>()` (below) makes this explicit.
- 🟢 Add a `json<T>(data: T)` helper so route handlers assert the **DTO** type they
  return, coupling each endpoint to its `@gallery/types` shape (today handlers
  return raw rows and rely on `Response.json` with no type check).
- 🟢 `live.ts` `DeviceStatus`/`ConnectionStatus` are both bare aliases of
  `LiveStatus`. Fine for documentation, but worth knowing they're identical (a
  future field on one won't apply to the other unless you split them for real).

---

## 9. Documentation drift (hurts "understanding the code")

You said you want the codebase easier to understand — the docs currently
contradict the code in places, which is its own kind of debt:

- 🟢 README §2/§4 still describe **Socket.io**; the server uses native `Bun.serve`
  WebSockets (`ws.ts`).
- 🟢 README §7.4 (Scheduler) and §13/PLAN P4 (TCP ingress / InputMapper) are
  described as if present, but `Scheduler.ts`, `TcpInputServer.ts`,
  `InputMapper.ts`, and the schedules/mappings routes **don't exist** in the tree.
  PLAN marks them `[ ]`; README reads as done. Align the two.
- 🟢 README mentions `scene_versions`, rollback, `created_by`/auth as live features
  that PLAN explicitly defers. Add "planned / not implemented" markers so a reader
  can trust the README.

---

## Suggested order of attack

1. **§3 + §6.4** (ApiError) and **§4** (dead code) — quick wins, one of them a real
   bug, low risk.
2. **§6.1/§6.2** (single socket + shared store plumbing) — biggest FE
   simplification, removes the most duplication.
3. **§1** (unify domain-event catalog + mechanical mapping) — biggest BE↔FE
   coupling win; do after §6 so the FE handler side is already centralized.
4. **§2** (driver IPC derivation) — largest, most contained; do when touching
   drivers next.
5. **§5 / §7 / §8 / §9** — opportunistic, as you pass through.

None of these change the event/log/broadcast architecture — they make adding a
value or an event a one- or two-file change instead of four, and delete code that
currently does nothing.
