# GalleryOS — Backend Feature Plan

Branch: `feat/backend-features`  
Priorities: Drivers → Scenes → Scheduling → TCP Ingress → UI (later) → Auth (later)

Mark items `[x]` as they are implemented and tested.

---

## Already done (core)

- [x] driver-core: `IDeviceDriver` contract, IPC protocol, `TcpClient` transport
- [x] `driver-pjlink` — PJLink Class 1 (auth, on/off/input/mute/readState).
      **Reworked** to match the protocol: short-lived connection per poll with
      *pipelined* queries (manual §5.3), an internal ~30 s status poll that emits
      `state` (so UIs see real power/input/mute/errors) via `subscriptions: true`,
      online iff the connection succeeds (an `ERR` response still counts as online;
      only a failed connection is offline), cached `healthCheck` (no watchdog
      double-poll / false timeouts), and full `ERR`/power/mute/ERST mapping.
      Global `DRIVER_COMMAND_TIMEOUT_MS` default 2000 → 5000 ms for IPC headroom.
- [x] `driver-tcp-generic` — configurable raw TCP send/receive
- [x] `DriverHost` — Bun.spawn subprocess manager with exponential-backoff restart
- [x] `DeviceManager` — per-endpoint command serialisation, live-state mirroring
- [x] `EventBus` — typed internal event bus
- [x] `DriverRegistry` — static manifest access
- [x] Drizzle ORM schema (12 tables), migrations, TimescaleDB hypertable for `logs`
- [x] **`@gallery/types` — shared contracts package (single source of truth):**
      Drizzle schema + derived record/DTO types (`Jsonify` for `Date→string`),
      live-state types (`DeviceState`/`*Status`), and the WebSocket message
      contract (`ServerMessage`/`ClientMessage`). Consumed by both `@gallery/server`
      and `@gallery/ui`; the UI imports `type`-only so Drizzle is erased from its
      bundle.
- [x] Redis live state (`device:*/connection:*` keys)
- [x] REST API: `/drivers`, `/rooms`, `/connections`, `/devices`, `/system`
- [x] WebSocket (`/ws`) — EventBus → client broadcast, `device:command` inbound
- [x] Winston logging — HTTP/WS requests, device commands, IPC trace, wire-level protocol
- [x] Docker: multi-stage Dockerfile, compose with server + Postgres + Redis

---

## Step 0 — Cross-cutting infrastructure

Small pieces that unblock everything; land first.

### 0.1 Watchdog `src/core/Watchdog.ts` ✓
- [x] **Layer 1 — Connection health** (interval: `WATCHDOG_CONNECTION_INTERVAL_MS`, default 10 s)
  - Call `DriverHost.healthCheck()` for every running host
  - Write `connection:{id}:status` to Redis
  - Emit `connection.connected` / `connection.disconnected` on state change (DeviceManager already handles these to mark endpoints)
- [x] **Layer 2 — Endpoint health** (interval: `WATCHDOG_ENDPOINT_INTERVAL_MS`, default 60 s)
  - Only for drivers that implement `endpointHealthCheck`
  - Stagger: spread checks evenly across the interval instead of all at once
  - Write `device:{id}:status` to Redis; emit `device.online` / `device.offline`
- [x] Wire into `src/index.ts` (start/stop with the rest of the core)

### 0.2 DB log transport `src/db/log-transport.ts` ✓
- [x] Winston transport that async-inserts into the `logs` hypertable
- [x] Batch inserts (flush every 500 ms or 50 records, whichever comes first) to avoid write pressure
- [x] Wire into `src/index.ts` (`winstonRoot.add(...)` + drain remaining entries on shutdown)

### 0.3 Logs REST API `src/api/routes/logs.ts` ✓
- [x] `GET /api/v1/logs` — `?level=` `?source=` `?entity_id=` `?from=` `?to=` `?limit=` `?offset=`
- [x] `GET /api/v1/logs/stats` — counts by level for last 24 h / 7 d
- [x] `GET /api/v1/logs/executions` — scene execution history with outcome + duration

### 0.4 Input validation (Ajv) `src/api/validation.ts` ✓
- [x] Compile each driver manifest's `connectionSchema` / endpoint `addressSchema` /
      command `paramsSchema` with Ajv (cached per driver+schema; `ajv-formats` for
      `hostname`). Failures throw `HttpError(400, "VALIDATION", …, ajvErrors)`.
- [x] Enforced at three points: `connections` POST/PUT (config, recombined
      `{host, port, …config}`), `devices` POST/PUT (address), and a **single choke
      point** for command params — an injected `validateParams` on
      `DeviceManager.execute()` that covers REST, WebSocket, and scene execution
      uniformly (a bad param → REST 400 / WS `ack.success:false` / failed scene action).
- [x] Reconciled the seed to the canonical params it had drifted from (`level` 0..1,
      `setMute {muted}`); a hermetic `test/db/seed-conformance.test.ts` validates every
      seeded connection config / device address / scene-action param against the
      manifests, so the seed can't drift out of spec again.

### 0.5 Continuous integration `.github/workflows/ci.yml` ✓
- [x] `check` job (the gate): `bun run typecheck` (now also type-checks the server
      `test/**`), `bun test apps/server packages`, and UI `vitest run`. UI lint and
      `fallow` run too but are informational (red on vendored UI primitives / scaffolding).
- [x] `integration` job: TimescaleDB + Redis service containers → `migrate` →
      `GALLERY_INTEGRATION=1` suite. Bun pinned to the production image's version.

### 0.6 Typed API client `apps/ui/src/lib/api.ts` ✓
- [x] One typed `api` object over the whole REST surface, keyed to the `@gallery/types`
      DTOs — a server contract change is now a UI compile error. The `devices` /
      `connections` / `scenes` stores call it instead of hand-written `fetch('/api/v1/…')`.

---

## Priority 1 — Drivers

### 1.1 `driver-template` ✓
- [x] Fully-commented manifest with placeholder JSON schemas
- [x] Skeleton driver class with `// TODO` guide in every method
- [x] Template test file (6 standard cases: connect, command, readState, dry-run, unknown-command, disconnect)
- [x] `mock-device.ts` helper template

Self-contained package (`packages/drivers/driver-template/`): the working driver,
its mock (`test/mock-device.ts`), and its 6-case test (`test/template.test.ts`)
all live together so a developer copies one folder to bootstrap a new driver. The
skeleton is a runnable toy ASCII line-protocol driver (not a non-compiling stub),
so the tests pass out of the box.

### 1.2 `driver-bss` — BSS Soundweb London (London DI protocol / TCP 1023) ✓

⚠️ **Protocol correction:** the original plan guessed a `SOF|len|…` HiQnet framing
with 2-byte message types and a `GET_VALUE 0x010F`. The actual protocol (per the
bundled `manuals/Soundweb-London-Third-Party-Control.pdf` and the field-tested
`manuals/bss.js`) is the **London DI protocol** — implemented against the manual.

**Protocol** (binary, `STX … ETX` framed):
- Frame: `STX(0x02) │ substitute( body │ checksum ) │ ETX(0x03)`
- `body = type(1) │ node(2) │ virtualDevice(1) │ object(3) │ param(2) │ value(4)`
- `checksum` = single-byte XOR of `body`, computed **before** byte substitution
- Byte substitution escapes 5 reserved bytes: `0x02 0x03 0x06 0x15 0x1B` → `0x1B 0x8x`
- 1-byte message types: `0x88 SET`, `0x89 SUBSCRIBE`, `0x8A UNSUBSCRIBE`,
  `0x8D SET PERCENT`, `0x8E SUBSCRIBE PERCENT`, `0x8F UNSUBSCRIBE PERCENT`, `0x8C RECALL PRESET`
- **No GET** — reads use SUBSCRIBE (device pushes the current value immediately)
- **No app-level keepalive** — manual says leave the TCP socket open indefinitely
  (no ACKs over Ethernet); the guessed `0x006E` keepalive was dropped
- Values are 32-bit signed BE; percent-raw = `percent × 65536` (faders use SET PERCENT)

**Multi-endpoint**: one TCP socket per BSS processor, shared by all faders. Driver
maintains a `node:vd:object:param → {endpointId, field}` route map for inbound pushes.

**Endpoint type:** `bss-soundweb.fader`  
**Address:** `{ node, object, virtualDevice?=3, gainParam?=0, muteParam?=1 }` — a fader
needs *two* params (gain + mute), so the address carries both rather than the single
`parameter` the plan sketched.  
**Commands:** `setLevel (0..1)` → SET PERCENT, `setMute (bool)` → SET; `readState` via SUBSCRIBE  
**Capabilities:** `subscriptions: true`, `bidirectional: true`, `discovery: false`

- [x] Binary frame builder/parser (`src/london-di.ts`) — pure, unit-tested (incl. exact `bss.js` frame)
- [x] `BssSoundwebDriver.ts` — persistent socket, subscribe on connect, route inbound events
- [x] Reconnect (internal backoff) resubscribes all active endpoints
- [x] Mock TCP server for tests (`test/mock-device.ts`)
- [x] Register in `apps/server/src/drivers/registry.ts` (id `bss-soundweb`, pkg `@gallery/driver-bss`)
- [x] **Live meters** — endpoint `bss-soundweb.meter-widget` + `subscribeMeter`/`unsubscribeMeter`
      (SUBSCRIBE/UNSUBSCRIBE raw on a single meter param), `meter` events ({@link MeterUpdate},
      dB×10000 → 0..1 level). Server-side ref-counted fan-out in `MeterService` (one BSS
      subscription per meter, forwarded only to watching WS clients via `meter:subscribe` /
      `meter:unsubscribe` / `meter:update`); UI `BssMeterWidget` subscribes on mount / unsubscribes
      on unmount.

### 1.3 `driver-dali-lunatone` — Lunatone DALI-2 IoT gateway ✓

Target: **Lunatone DALI-2 IoT** module (Art.Nr. 89453886). ⚠️ **Protocol correction:**
the original plan assumed a text-based TCP protocol (`>A {addr} ...<`); the actual
device (per the bundled manual) exposes an **HTTP REST + JSON API on port 80** with
no authentication. Implemented against the real API.

**Protocol** (HTTP REST, base `http://<ip>:80`):
- `GET  /info` — reachability / health probe
- `GET  /devices` — list registered fixtures + their feature state
- `GET  /device/{id}` — single fixture state
- `POST /device/{id}/control` — apply a `ControlData` object, e.g. `{ "switchable": true }`,
  `{ "dimmable": 50 }` (percent 0..100), `{ "scene": 4 }`
- `POST /dali/scan` + `GET /dali/scan` — bus scan for discovery (~1 min, polled)

**Endpoint type:** `dali.fixture`  
**Address:** `{ deviceId: number, daliAddress?: 0..63 }` — fixtures are controlled by the
gateway's *identifying number* (`deviceId`, assigned during a scan), which differs from
the raw DALI short address; the short address is kept as read-only metadata.  
**Commands:** `on`, `off`, `setBrightness { level: 0..1 }` (→ `dimmable` 0..100), `recall { scene: 0..15 }`  
**Capabilities:** `discovery: true`

- [x] `DaliLunatoneDriver.ts` — Bun-native `fetch`, no extra deps
- [x] `discoverEndpoints()` — GET /devices (optional bus scan first via `scanOnDiscover`)
- [x] Mock DALI-2 IoT HTTP server for tests (`test/mocks/mock-dali-iot.ts`)
- [x] Register in registry (id `dali-lunatone`)

### 1.4 `driver-extron-matrix` — Extron matrix switcher (SIS / TCP 23) ✓

Target: **Extron DTP CrossPoint 108 4K** (10 inputs × 8 outputs). ⚠️ **Protocol
correction:** the original sketch guessed `%`=audio and an `I{out}` query. The
actual Extron **SIS** grammar (implemented in the pure, unit-tested `src/sis.ts`)
is **verified against the bundled manual** (`manuals/Extron-108-manual.pdf`,
Programming Guide pp. 63-64 + "Establishing a connection" / "Error Responses"):

**Protocol** (ASCII, CR-terminated commands; CR/LF-framed responses):
- `{in}*{out}!` — tie input→output, **AV/All** (audio + video together)
- `{in}*{out}%` — tie input→output, **video** only
- `{in}*{out}$` — tie input→output, **audio** only (input `0` unties an output)
- `{out}%` / `{out}$` — **query** the video / audio input on an output (no `{in}*` prefix)
- Tie echo: `Out02 In05 All`; query echo: `In05`; errors: `E##` (mapped to messages)
- Optional `Password:` handshake on connect (config `password`)

**Connection + endpoint model:** one persistent TCP socket per switcher, shared
by every output. Each *output* is one `extron-matrix.output` endpoint (a Device
in a room) exposing a single "which input?" choice — an 8-output unit = 8 devices.
The 10×8 grid is never surfaced. Device I/O is serialised behind a mutex so the
`Out.. In..` echo is matched to the in-flight request by output number;
unsolicited front-panel ties refresh the cache and surface on the next poll.

**Endpoint type:** `extron-matrix.output`  
**Address:** `{ output: 1..outputCount }`  
**Connection config:** `{ host, port?=23, password?, inputCount?=10, outputCount?=8, responseTimeoutMs?, reconnectMs? }`  
**Commands:** `setInput { input }` (AV), `setVideoInput { input }`, `setAudioInput { input }`, `readState`  
**Capabilities:** `subscriptions: false` (poll-based, but emits `state` on echo), `bidirectional: true`, `discovery: false`

- [x] `src/sis.ts` — pure SIS codec (builders + tolerant response parser), unit-tested
- [x] `ExtronMatrixDriver.ts` — persistent socket, reconnect/backoff, password handshake, mutex-serialised request/response
- [x] Mock SIS device for tests (`test/mock-device.ts`) — ties, queries, auth, `E##`, front-panel push
- [x] Register in `apps/server/src/drivers/registry.ts` (id `extron-matrix`, pkg `@gallery/driver-extron-matrix`)
- [x] Seed: one connection + 8 output devices. **Input labels live on the connection**
      (`config.inputs`, named once per matrix), not duplicated per output device
- [x] **User UI:** generic `select` widget (§5 "Driver-agnostic widgets") — one input
      `<select>` per output (`setInput`); options built straight from the connection's
      `config.inputs`/`config.inputCount` (`SelectWidgetBinding.connectionOptions`,
      §5 "select options without live state"), no live device state involved

### 1.5 `driver-samsung-mdc` — Samsung MDC (TCP 1515) ✓ (power on/off only)

**Protocol** (binary), verified against the public MDC Protocol reference
(cross-checked with the `vgavro/samsung-mdc` implementation of the same spec):
- Frame: `0xAA | cmd(1) | displayId(1) | len(1) | data[len] | checksum(1)`,
  `checksum = (cmd/0xFF + displayId + len + sum(data)) & 0xFF`
- Response: `0xAA | 0xFF | displayId(1) | len(1) | ack(1) | cmd(1) | data[len-2] | checksum(1)`,
  ack = `0x41`('A') / nak = `0x4E`('N')
- `0x11` — Power Control (implemented): 0-length data = GET, 1-byte data = SET
  (`0x00` off / `0x01` on / `0x02` reboot)
- Deferred (not implemented): `0x14` input source select, `0xF9` combined status query

**Scope note:** only power on/off was requested, so this is intentionally a
thin slice — one command (0x11), no input select, no video wall. Extending it
later is additive (new command builders in `mdc.ts` + cases in the driver).

**Connection + endpoint model:** one persistent TCP socket per gateway (built-in
display LAN port, or an RS232-over-Ethernet bridge for a daisy-chain), shared by
every display endpoint — mirrors the `driver-extron-matrix` / `driver-bss`
persistent-socket + mutex-serialised request/response pattern. Each display is
addressed by its MDC display ID; responses are matched to the in-flight request
by displayId + echoed command.

**Endpoint type:** `samsung-mdc.display`  
**Address:** `{ displayId: 1..255 }`  
**Connection config:** `{ host, port?=1515, responseTimeoutMs?, reconnectMs? }`  
**Commands:** `on`, `off`, `readState` (power only)  
**Capabilities:** `subscriptions: false` (no unsolicited push), `bidirectional: true`
(power read back via GET), `discovery: false`, `endpointHealth: true` (each display
probed independently since several can share one connection)

- [x] `src/mdc.ts` — pure MDC codec (frame encode, length-prefixed incremental
      decoder, checksum, ACK/NAK parsing), unit-tested
- [x] `SamsungMdcDriver.ts` — persistent socket, reconnect/backoff, mutex-serialised
      request/response matched by displayId + command
- [x] Mock MDC device for tests (`test/mock-device.ts`) — multiple display ids on
      one connection, GET/SET, NAK for unknown display id/command
- [x] Register in `apps/server/src/drivers/registry.ts` (id `samsung-mdc`, pkg
      `@gallery/driver-samsung-mdc`)
- [ ] `setInput` (0x14) and combined status query (0xF9) — deferred, not requested yet

### 1.6 `driver-vmix` — vMix (TCP 8099)

**Protocol** (UTF-8, newline-delimited, persistent socket):
- On connect: send `SUBSCRIBE ACTS\r\n` to receive XML push events
- Commands: `FUNCTION {name}\r\n` or `FUNCTION {name} Input={n}&Value={v}\r\n`
- State push: XML snippets like `<vmix><inputs>...<input number="1" muted="False" volume="100">...</input></inputs></vmix>`

**Endpoint type:** `vmix.input`  
**Address:** `{ inputNumber: 1..n }`  
**Commands:** `cut`, `fade { duration?: ms }`, `setVolume { level: 0..1 }`, `setMute { muted: bool }`  
**Capabilities:** `subscriptions: true`

- [ ] `VMixDriver.ts` — XML state parser
- [ ] Register in registry

> **Deferred:** `driver-pixera` — implement later when needed.

---

## Priority 2 — Scenes

Simplified vs. original spec:
- **No scene versioning** — `scene_versions` table stays in schema (for potential future use) but no version-on-save logic
- **No crash recovery** — no pre-state capture, no rollback, no recovery of interrupted executions
- `on_failure` modes: `continue` and `abort` only (no `rollback`)
- Scene conflict: if already running → reject with 409

### 2.1 Scene repositories `src/db/repositories.ts` ✓
- [x] `scenesRepo.list({ roomId?, isFavorite?, tags? })` — tags via `arrayOverlaps`
- [x] `scenesRepo.get(id)` — includes `actions` array ordered by `step_order`
- [x] `scenesRepo.create(data)` — with initial `scene_actions`
- [x] `scenesRepo.update(id, data)` — replace actions (delete + insert); `setFavorite(id, bool)`
- [x] `scenesRepo.remove(id)` (cascade deletes actions + executions)
- [x] `sceneActionsRepo.replaceAll(sceneId, actions[])`
- [x] `sceneExecutionsRepo.create(data)` (optional explicit id), `.updateStatus(id, status, durationMs?, error?)`
- [x] `sceneExecutionsRepo.listByScene(sceneId)`, `.getRunning(sceneId)`

### 2.2 `SceneEngine` `src/core/SceneEngine.ts` ✓
- [x] `executeScene(sceneId, source, { executionId? })` — runs to completion; `startScene(...)` runs in the background and returns `{ executionId, status: "running" }` for REST
- [x] **Pre-flight:** load scene + actions; verify devices exist; check `scene:{id}:active` (reject → `SceneConflictError`); typed errors (`SceneNotFoundError`/`SceneConflictError`/`SceneValidationError`) thrown before any side effect
- [x] **DB write:** INSERT `scene_executions { status: 'running' }`; set `scene:{id}:active`; emit `scene.execute.started`
- [x] **Execution planner:** `planGroups()` groups by `parallel_group` ascending; each group `Promise.all`; `delay_ms` via `Bun.sleep`; `abort` breaks remaining groups + fails, `continue` logs and proceeds
- [x] **Completion:** update `scene_executions`; clear `scene:{id}:active`; emit `scene.execute.completed/failed`
- [x] **Dry run:** `dryRun(sceneId)` validates + returns the plan **without** touching hardware/lock/DB (live drivers aren't in dry-run mode, so the engine simulates rather than calling them — corrects the PLAN's "pass dryRun to DeviceManager" assumption)
- [x] Dependencies injected via narrow interfaces (hermetically testable); `start()` subscribes to `scene.execute.requested`
- [x] Wired into `src/api/context.ts` and `src/index.ts`
- [x] **Scene composition (sub-scenes):** an action can target another scene via `child_scene_id` instead of a device. A parent ("Turn off everything") is composed of children ("Turn off Hall A/B/Foyer"); editing a child propagates to every parent (reference, not copy). A sub-scene runs its full plan as a nested run (own execution row, lock, events) at the action's position. Pre-flight resolves the whole tree, validates devices + sub-scenes, and rejects cycles (`SceneValidationError`); `MAX_SCENE_DEPTH = 16` backstop. A sub-scene counts as a failed action (honouring `on_failure`) when its overall status is `failed` or the nested run is rejected (e.g. child already running). DB: `scene_actions.device_id`/`command` nullable, new `child_scene_id` FK (`ON DELETE RESTRICT`), CHECK constraint enforcing exactly one target (migration `0001_scene_composition`).

Redis key additions to `src/redis/state.ts`:
- [x] `redisSceneStore`: `setSceneActive(sceneId)`, `clearSceneActive(sceneId)`, `isSceneActive(sceneId)` (`scene:{id}:active`)

### 2.3 Scenes REST API `src/api/routes/scenes.ts` ✓
- [x] `GET    /api/v1/scenes` — `?room_id= &is_favorite= &tags=`
- [x] `POST   /api/v1/scenes` — `{ name, roomId?, description?, icon?, color?, tags?, actions[] }` (actions validated; each action is a device action `{ deviceId, command, params?, … }` **or** a sub-scene action `{ childSceneId, … }`)
- [x] `GET    /api/v1/scenes/:id` — scene + actions
- [x] `PUT    /api/v1/scenes/:id` — replace scene metadata + actions
- [x] `DELETE /api/v1/scenes/:id`
- [x] `POST   /api/v1/scenes/:id/execute` — `{ source? }` → `202 { executionId, sceneId, status }` (409 if running)
- [x] `POST   /api/v1/scenes/:id/execute/dry-run`
- [x] `GET    /api/v1/scenes/:id/executions`
- [x] `PATCH  /api/v1/scenes/:id/favorite` — `{ is_favorite: bool }`

### 2.4 WebSocket: scene:execute ✓
- [x] `scene:execute` handler in `src/api/ws.ts`: validates scene exists; generates executionId; emits `scene.execute.requested`; replies `scene:execute:ack { executionId, status: "requested" }`
- [x] SceneEngine listens for `scene.execute.requested` and runs; `scene:started/completed/failed` already broadcast via the EventBus bridge

### 2.5 WebSocket: device:state de-duplication ✓
- [x] `setupBroadcast` (`src/api/ws.ts`) now de-duplicates `device:state` per device by content. One user action emits two identical `device.state.changed` events — the optimistic `command` result and the driver's `echo` — but the UI only needs the change once. The bridge tracks the last state sent per device and skips a broadcast when the serialized state is unchanged; suppressed echoes are still logged server-side. Non-state events always pass through. Covered by `test/api/ws-broadcast.test.ts`.

### 2.6 WebSocket: device:command ack contract ✓
- [x] Optimistic-update flow: origin emits `device:command`, applies the change locally, and waits for `device:command:ack` (sent to the origin only). On **success** the canonical state is persisted and broadcast once to all UIs (via §2.5); on **failure** nothing is persisted or broadcast (just a `warn` log) and the origin reverts. The ack always carries an explicit `success: boolean` — including the thrown-exception path — so the UI can uniformly decide stay-vs-revert. Covered by `test/api/ws-command.test.ts`.

---

## Priority 3 — Scheduling ✓

**Timezone handling:** cron expressions run in each job's own IANA timezone; the
Scheduler computes the absolute **UTC** fire time and schedules via `setTimeout`.
After each fire it recomputes the *next* occurrence, so DST transitions are
handled correctly — the offset is sampled fresh each time rather than assumed
constant. (Storage + computation are UTC; conversion to local time is display
logic only.)

⚠️ **PLAN correction:** §3 assumed `Temporal.ZonedDateTime` is built into Bun, but
it is **not** available in the runtime (Bun 1.3.x, no Temporal global). The
wall-clock ↔ UTC conversions are implemented with `Intl.DateTimeFormat` instead
(always present, fully DST-aware). Same outcome — the example below holds: a job
set to `0 9 * * *` in `Europe/Prague` fires at 08:00 UTC in winter and 07:00 UTC
in summer.

### 3.1 `Scheduler` `src/core/Scheduler.ts` ✓
- [x] On `start()`: load all enabled `scheduled_jobs`; arm one `setTimeout` per job
- [x] `scheduleJob(row)`: validate + compute next UTC fire (`computeNextRun`),
      persist `next_run_at`, arm the timer; after each fire call
      `SceneEngine.executeScene(sceneId, 'scheduler', { sourceDetail })`, persist
      `last_run_at`, and re-arm the next occurrence
- [x] Long-delay safety: waits over `setTimeout`'s ~24.8-day clamp are chunked and
      re-evaluated, so far-future crons (e.g. a yearly Feb-29 job) still fire
- [x] On startup: compare `next_run_at` vs now — a missed run is **warned** (never
      auto-run), then the job is re-armed going forward
- [x] Dynamic API: `addJob(row)`, `removeJob(id)`, `reloadJob(id)` — used by the
      schedules REST controller so cron changes apply without a server restart
- [x] `stop()` — cancels all pending timers gracefully (wired into shutdown)
- [x] Wired into `src/api/context.ts` and `src/index.ts`; clock + timer functions
      are injectable so the engine is testable with virtual time (no real timers)

### 3.2 Next-runs helper `src/core/cron.ts` ✓
- [x] `computeNextRuns(cronExpr, timezone, count, from?)` — pure function returning
      the next N UTC timestamps; `computeNextRun(...)` for the single next one
- [x] Full 5-field cron grammar: `*`, lists, ranges, steps, and Vixie DOM/DOW
      OR-semantics; `parseCron`/`isValidCron` for validation (→ HTTP 400)
- [x] Used by `GET /schedules/:id/next`, the Scheduler, and the seed-conformance test

### 3.3 Schedules REST API `src/api/routes/schedules.ts` ✓
- [x] `GET    /api/v1/schedules`
- [x] `POST   /api/v1/schedules` — `{ name, sceneId, cron, timezone?, enabled? }`
      (cron + timezone validated → 400; unknown `sceneId` → 400 not a raw FK 500;
      arms the live Scheduler)
- [x] `GET    /api/v1/schedules/:id`
- [x] `PUT    /api/v1/schedules/:id` → `Scheduler.reloadJob()`
- [x] `DELETE /api/v1/schedules/:id` → `Scheduler.removeJob()`
- [x] `PATCH  /api/v1/schedules/:id/toggle` — explicit `{ enabled }` or flips current
- [x] `GET    /api/v1/schedules/:id/next` — next N (default 5, `?count=`) UTC fire times

**Types/repos/seed/tests:** `ScheduledJob`/`ScheduledJobDTO` + `ScheduleCreateInput`
in `@gallery/types`; `scheduledJobsRepo` (CRUD + `setEnabled` + Scheduler
write-backs); three sample jobs in the seed (validated by the seed-conformance
test). 45 new tests: pure cron parser/next-runs (incl. winter/summer + spring-
forward DST), the Scheduler with virtual time, and the REST routes.

---

## Priority 4 — Input Ingress (OSC / TCP)

### 4.1 `InputMapper` `src/input/InputMapper.ts` ✓
Shared, transport-agnostic ingress logic. An ingress server only normalises its
wire format into an `InputSignal` (`{ protocol, address, args }`) and calls
`handle(signal)`; matching, templating, and dispatch live here once so TCP/OSC/HTTP
behave identically.
- [x] Pattern matching (pure `src/input/patterns.ts`): exact (`/scene/execute`) and
      parameterised (`/dim/:level`), the latter capturing each `:name` segment.
- [x] Template evaluation: a `paramsTemplate` value is a literal (passed through), a
      whole-token reference (`{arg[0]}` / `{:level}`, keeping the referenced value's
      type — path params coerced from numeric/bool strings), or an embedded token
      (interpolated as text). Nested objects/arrays recurse; unresolved refs drop the key.
- [x] In-memory cache of the **enabled** mappings grouped by protocol, with `reload()`
      called by the mappings CRUD so edits take effect without a restart.
- [x] Dispatch — `scene.execute` → `SceneEngine.startScene` (source = protocol),
      `device.command` → `DeviceManager.execute` (templated params), `event.emit` →
      `EventBus.emit("input.mapping.triggered", …)` (a typed, server-side hook, since
      the bus catalog is closed). Each match yields a `DispatchOutcome`; one signal can
      fire several rules. Failures are caught per-rule (never throw out of `handle`).

### 4.2 `TcpInputServer` `src/input/TcpInputServer.ts` ✓
> The TCP sibling of `OscServer` — a thin transport layer over `InputMapper.handle()`.
- [x] `Bun.listen` on `TCP_INPUT_PORT` (8766); persistent connections, newline-delimited
      JSON frames (`{ "address": "/x", "args": [..] }`; a bare JSON string is an
      address-only frame). Per-connection buffer on `socket.data` reassembles frames
      split across writes; a single un-terminated frame over 64 KiB is dropped (DoS
      guard). `\r` before `\n` (CRLF) stripped; blank lines (keep-alives) ignored.
- [x] Per frame: emit `input.tcp.received`; normalise to `{ protocol: "tcp", address,
      args }` and call `InputMapper.handle()`. A malformed frame (bad JSON / missing
      `address`) is logged and dropped — a bad sender never breaks the server or its
      other connections.
- [x] Wired into `src/index.ts` (started after the InputMapper, stopped on shutdown);
      a bind failure is logged but does **not** crash the server (TCP is auxiliary).
- [x] 11 tests: the pure framing/normalization helpers (`extractFrames`/`normalizeFrame`),
      the server's `receiveFrame()` paths, and a real TCP round-trip that sends two
      newline-delimited frames (one split across writes) and asserts both arrive in
      order (`test/input/tcp-server.test.ts`).

> **The UI (admin Mappings page) is already protocol-agnostic** — `PROTOCOL_OPTIONS`
> in `apps/ui/src/lib/mappings.ts` lists `tcp` alongside `osc`/`http`, so the
> create/edit form, the rules list, and the `/test` dry-run dialog all drive TCP
> mappings the same way as OSC with no changes.

### 4.3 InputMappings REST API `src/api/routes/mappings.ts` ✓
- [x] `GET    /api/v1/mappings` — `?protocol=` `?enabled=`
- [x] `POST   /api/v1/mappings` — validates protocol/targetType, requires the target
      that `targetType` needs (`scene.execute`→scene id, `device.command`→device id +
      command), and that the referenced scene/device exists (→ 400); reloads the cache
- [x] `GET    /api/v1/mappings/:id`
- [x] `PUT    /api/v1/mappings/:id` — re-validates the *effective* (merged) target; reloads
- [x] `DELETE /api/v1/mappings/:id` — reloads
- [x] `PATCH  /api/v1/mappings/:id/toggle` — enable/disable (explicit `{enabled}` or flip); reloads
- [x] `POST   /api/v1/mappings/test` — `{ protocol, address, args? }` → dry-run match
      result (rules that fire + captured path params + evaluated params), no dispatch

**Types/repo/tests:** `InputMapping`/`InputMappingDTO` + `InputMappingCreateInput`/
`InputMappingTestResult` and the `InputProtocol`/`InputTargetType` enums in
`@gallery/types` (applied to the schema columns via `$type<>()`); `inputMappingsRepo`
(CRUD + `listEnabled` + `setEnabled`). New `input.mapping.triggered` event in the
catalog (projected to nothing on the wire). 67 new tests: pure pattern/template
(`test/input/patterns.test.ts`), the mapper's cache/match/dispatch with fakes
(`test/input/input-mapper.test.ts`), and the REST routes (`test/api/mappings.test.ts`).
The `input_mappings` table already existed in the schema/migration `0000`.

### 4.4 `OscServer` `src/input/OscServer.ts` ✓
The first real ingress transport on top of the InputMapper — a UDP listener that
turns incoming OSC into actions.
- [x] **`src/input/osc.ts`** — pure, unit-tested OSC 1.0 decoder (no deps): OSC-string/
      blob/type-tags, args (`i f s S b h t d T F N I c r m`; 64-bit narrowed to `number`),
      and bundles (recursively unwrapped, time-tag ignored). Bad bytes → `OscParseError`.
- [x] **`OscServer`** — `Bun.udpSocket` on `OSC_PORT` (default 8765). `receive(datagram)`
      (socket-free, directly testable) decodes the packet and, per message, emits
      `input.osc.received` and calls `InputMapper.handle({ protocol: "osc", address, args })`.
      Malformed datagrams are logged + dropped.
- [x] Wired into `src/index.ts` (started after the InputMapper, stopped on shutdown);
      a bind failure is logged but does **not** crash the server (OSC is auxiliary).
- [x] 17 tests: the pure decoder (`test/input/osc.test.ts`, with a test-only encoder
      `test/input/osc-encode.ts`) and the server's `receive()` + a real UDP round-trip
      (`test/input/osc-server.test.ts`).

> **TcpInputServer (§4.2)** is now done: the same shape over `Bun.listen` +
> newline-delimited JSON → `InputMapper.handle`, with per-connection framing.

---

## Priority 5 — UI (later)

Single Vue 3 app (`apps/ui`) — admin portal and user panel in one Vite project, separated by route-based layouts. Shared Pinia stores, shared components, single WebSocket connection.

- [~] `apps/ui` — Vue 3 + Vite + Pinia + TailwindCSS v4 + shadcn-vue
  - [x] **Route-based layouts (resolves [DECIDE] G7):** one app, not two. `App.vue`
        is a thin global shell (single `/ws`, store hydration); `UserLayout` wraps
        the root user routes (`/`, `/rooms/:id`, `/schedules`, `/iframes/:id`) and
        `AdminLayout` + `AdminSidebar` wrap `/admin/**`. Admin parent carries
        `meta.admin` with a router-level auth-guard placeholder (auth deferred —
        P6; structural separation only for now). Not-yet-built admin sections show
        as disabled in the nav.
  - [~] Admin pages: dashboard, rooms, connections, devices, scenes, schedules, mappings, workflows, layouts, logs, settings
    - [x] **`/admin/logs`** (`views/admin/LogsView.vue`) — Logs/Executions tabs,
          filters (level/source/entity/time), pagination, Refresh + auto-poll,
          per-row metadata detail, CSV export. Fetch/refresh based (no `log` WS
          event yet — backend follow-up). New `useLogsStore` + pure `lib/logs.ts`
          helpers (unit-tested). New `GET /logs` filter fields wired in `lib/api.ts`.
    - [x] **`/admin/dashboard`** (`views/admin/DashboardView.vue`) — device/
          connection/scene/system stat cards, per-connection status, favourite-
          scene quick actions, recent-logs panel. New `useSystemStore`.
    - [x] **`/admin/connections`** (`views/admin/ConnectionsView.vue`) — live table
          (status dot, enable/disable, edit, delete) + `ConnectionFormDialog`.
    - [x] **`/admin/devices`** (`views/admin/DevicesView.vue`) — table with room/
          type filters, online dot, enable/disable, edit, delete +
          `DeviceFormDialog`.
    - [x] **`/admin/scenes`** (`views/admin/ScenesView.vue`) — table (favourite
          toggle, run, edit, delete; room filter) + `SceneFormDialog`: flat
          metadata (vee-validate + Zod) plus an ordered, reorderable **actions
          editor** (`SceneActionRow`). Each action targets a device command —
          command list + param fields resolved from the driver manifest via
          `composables/useDeviceCommands` — or a sub-scene. Pure converters in
          `lib/sceneActions.ts` (unit-tested); params coerced to the command's
          schema on submit.
    - [x] **`/admin/schedules`** (`views/admin/SchedulesView.vue`) — table (scene,
          cron, timezone, next-run preview, enable/disable, edit, delete) +
          `ScheduleFormDialog` (vee-validate + Zod, client-side `isValidCron`
          check). `useSchedulesStore` gained CRUD + `toggle`; `lib/api.ts` gained
          schedule create/update/remove/toggle.
    - [x] **`/admin/settings`** (`views/admin/SettingsView.vue`) — Appearance
          (persisted `light/dark/system` theme via `useThemeStore`, applied
          app-wide from `main.ts`), System (status/uptime/counts from
          `GET /system/*`), and an Installed-drivers catalogue (manifests joined
          with per-connection runtime). Server-config editing / driver reload /
          backup are deferred until the backend exposes them. New `lib/system.ts`
          helpers (`formatUptime`, `capabilityLabels`, unit-tested); Dashboard's
          local `formatUptime` folded into it. New vendored `card` →
          `CardDescription`.
    - [x] **`/admin/rooms`** (`views/admin/RoomsView.vue`) — table with per-room
          device counts, up/down reordering, edit and delete (delete leaves
          devices/scenes unassigned via `ON DELETE SET NULL`). `RoomFormDialog`
          (name/description/icon/colour, vee-validate + Zod). New `useRoomsStore`
          + pure `lib/rooms.ts` (`sortRooms`, `computeReorder` — renumbers
          `displayOrder`, repairs ties; unit-tested).
    - [x] **`/admin/mappings`** (`views/admin/MappingsView.vue`) — table (name,
          protocol badge, pattern, resolved target, enable/disable, edit, delete) +
          `MappingFormDialog` (vee-validate + Zod; protocol/action selects, a
          conditional target — scene picker for "Run scene", device + command
          pickers for "Device command" via `useDeviceCommands` — and a JSON
          `paramsTemplate` editor) and `MappingTestDialog` (dry-run `POST
          /mappings/test` showing matched rules + evaluated params). New
          `useMappingsStore` (CRUD + `toggle` + `test`) and pure `lib/mappings.ts`
          (labels, `targetSummary`, `parseParamsTemplate`/`stringifyParamsTemplate`,
          `parseTestArgs`; unit-tested). `lib/api.ts` gained the `mappings` group.
    - [x] **`/admin/layouts`** (`views/admin/LayoutsView.vue`) — wall-screen /
          tablet **kiosks**. Table (name, canvas size, grid, tile count) +
          `KioskFormDialog` (name + canvas px width/height + grid columns / row
          height; vee-validate + Zod). Creating a layout jumps into the
          **Gridstack builder** (`views/admin/KioskBuilderView.vue`): a device
          palette whose chips drag-and-clone onto a fixed-pixel grid; tiles move,
          resize (span rows/cols), and delete with Gridstack enforcing bounds +
          no overlap. The builder is imperative (Gridstack owns the grid DOM;
          tiles are labelled placeholders) so Vue and Gridstack never fight; the
          layout serialises to `kiosk.config.tiles`. The chromeless viewer
          (`views/KioskView.vue`, route **`/kiosk/:name`**, no header/sidebar but
          inherits the global toasts/tooltips) reproduces the exact geometry with
          a plain CSS grid and renders the **live** `DeviceWidget`s (fed by the
          app-wide devices store + socket). New `useKiosksStore`, `api.kiosks.*`,
          and pure `lib/kiosks.ts` (`findKioskByName`, `tileGridStyle`,
          `canvasGridStyle`, `isValidCanvasSize`, `withTiles` — unit-tested).
          Backend: `kiosks` table (unique `name`, px `width`/`height`, `config`
          JSONB = `KioskConfig`), migration `0003_kiosks`, `kiosksRepo`, and
          `/api/v1/kiosks` CRUD + `/kiosks/by-name/:name` (the viewer lookup).
    - [x] **`/admin/iframes`** (`views/admin/IframesView.vue`) — table (display
          order, name, URL, edit, delete) + `IframeFormDialog` (vee-validate +
          Zod, client-side `isEmbeddableUrl` http(s) check). New `useIframesStore`
          (CRUD, list kept sorted by `displayOrder`) and `lib/iframes.ts`
          (`isEmbeddableUrl`, `sortByDisplayOrder`, unit-tested). `lib/api.ts`
          iframe create/update now typed via new `IframeCreateInput` /
          `IframeUpdateInput`; `AdminSidebar` entry enabled.
    - [x] **`/admin/cameras`** (`views/admin/CamerasView.vue`) — same shape as
          `/admin/iframes`: table (up/down display-order controls, name, URL,
          enabled toggle, edit, delete) + `CameraFormDialog` (vee-validate + Zod,
          client-side `isRtspUrl` check). `username`/`password` are write-only
          fields — the API never returns stored credentials (`CameraDTO` strips
          them), so both start blank on edit and a blank value means "leave
          unchanged" rather than "clear". `useCamerasStore` (previously
          read-only) gained `create`/`update`/`remove`/`move`, plus
          `computeCameraReorder` in `lib/cameras.ts` (mirrors
          `computeIframeReorder`, unit-tested); server-side CRUD, schema, and
          `lib/api.ts` client already existed. `AdminSidebar` entry enabled.
  - [x] **Manifest-driven forms (vee-validate + Zod):** the connection/device
        dialogs render dynamic fields from the driver manifest — `connectionSchema`
        for connections, the selected endpoint type's `addressSchema` for devices.
        `lib/schemaForm.ts` (unit-tested) turns a manifest JSON Schema into render
        descriptors + a Zod schema (mirroring the server's Ajv rules) + defaults;
        `SchemaFields.vue` renders them inside the shadcn-vue `form` (vee-validate)
        wrappers. Connection submit splits `host`/`port` (columns) from the
        `config` blob; device capabilities are derived from the endpoint type's
        commands. New `useDriversStore` (manifest cache); `useConnectionsStore` /
        `useDevicesStore` gained `create`/`update`/`remove`. The UI now type-only
        depends on `@gallery/driver-core` for manifest types (erased from bundle).
  - [x] **Vendored UI primitives added:** `table`, `tabs`, `badge`, `input`,
        `label`, `form` (vee-validate), `select`, `dialog`, `alert-dialog`,
        `separator`, `skeleton`, `textarea`, `alert`.
  - [x] **User panel — device control slice:** brightness fader, BSS fader +
        mute, on/off switch, **live BSS meters** (`BssMeterWidget` — bars that
        grow/shrink, subscribe on mount / unsubscribe on unmount). Each in a shared
        `DeviceCard` (title + description tooltip + online dot). Array-of-object
        address fields (the meter list) edited via `ArrayObjectField`.
        **Extron matrix output input-select**, a single input `<select>` per
        output sending `setInput`.
        **Superseded by "Driver-agnostic widgets" below** — widget selection is
        no longer a `subtype` switch; see that entry for the current design.
  - [x] **Driver-agnostic widgets:** replaced the `subtype` switch
        (`deviceKind()` in `lib/devices.ts` → one of five bespoke widget
        components) with a manifest-declared, driver-agnostic system — adding a
        new driver never touches the UI again.
        - **`EndpointTypeDefinition.widgets?: WidgetBinding[]`** (new,
          `packages/driver-core/src/types.ts`) — a manifest names, per endpoint
          type, which generic widget kinds it supports and which
          command/param/state key each is wired to (`power`/`mute`: two zero-arg
          commands or one boolean-param command; `fader`: a 0..1 level command;
          `select`: an enumerated choice, options either static in the manifest
          or a driver-computed list stamped onto state via `optionsKey`; `buttons`:
          a row of stateless fire-and-forget commands, added later by
          `driver-generic-trigger`, see below). A binding only ever *names*
          things — it carries no behaviour.
        - **All real translation moved into driver code**, not a declarative
          rules engine: `driver-bss` gained a first-class `bss-soundweb.matrix`
          endpoint type with canonical `on`/`off` commands and a `power` state
          key (replacing the `type==='matrix'` + inverted-`setMute` hack);
          `driver-dali-lunatone`/`driver-dali-foxtron` remember/restore a
          fixture's last brightness themselves (resolves H1, see below);
          `driver-extron-matrix`'s `select` binding is the one deliberate
          exception in the other direction — its options are read straight
          from connection config (`connectionOptions`, see below), since
          input labels are static per-connection data, not something a live
          device ever reports.
        - **UI composes, never special-cases:** `DeviceWidget.vue` resolves a
          device's `WidgetBinding[]` (`composables/useDeviceWidgets.ts`, joining
          the connection → driver → manifest, same pattern as
          `useDeviceCommands`) and stacks one generic component
          (`PowerWidget`/`FaderWidget`/`SelectWidget`, dispatched by
          `GenericWidget.vue`) per binding inside one `DeviceCard` — a device
          declaring `[fader, mute]` gets both, automatically. A fader
          auto-dims (and, next to a *power* companion, routes a drag-commit to
          `patchDeviceState` instead of a live command) while its sibling
          power/mute binding is off/muted — pure composition, no driver
          involved. The **one deliberate exception** is the BSS live-meter
          panel (a whole panel of bars fits no generic kind) — matched by
          endpoint type via `lib/widgets.ts#isCustomWidgetType`, same as it
          would need to be even in a fully declarative system.
        - The command palette (`lib/commands.ts`) lost its
          `subtype === 'extron-matrix.output'` special case; a select binding's
          options now generate quick actions for any driver's select widget.
        - `bss-soundweb.matrix` promotion needed a real data migration (there
          are live devices, not just the seed) —
          `0006_bss_matrix_endpoint_type.sql` backfills
          `subtype='bss-soundweb.fader' AND type='matrix'` rows, idempotent
          (verified against a real Postgres instance, including a no-op
          re-run).
  - [x] **Routing + room sidebar (`vue-router`, `AppSidebar`):** `/` = all
        devices, `/rooms/:roomId` = that room (URL is the source of truth; a
        refresh stays put, unknown paths → `/`). The store carries a `roomScope`
        (set from the route) so the toolbar/grid run on `scopedDevices`; the
        command palette stays global (`store.devices`). Room/Type grouping +
        filters adapt to scope.
  - [x] **`useDevicesStore`** — hydrates every device + Redis state/status over
        HTTP once, then live-updates over the `/ws` WebSocket; control commands
        go back over the same socket as `device:command`.
  - [x] **`useConnectionsStore` + `ConnectionStatus` indicator** — header badge
        next to the realtime (WiFi) icon showing `connected/total` (e.g. "7/9")
        for enabled connections; green only when all enabled are connected, red
        otherwise. Click opens a popover listing each connection with a
        colour-coded state (connected · reconnecting · disconnected · disabled),
        name, type, error message, and an enable/disable switch. Backed by
        `GET /connections/live` + live `connection:connected`/`disconnected`/
        `driver:error` WS events.
  - [x] **Grouping (nested) + type/room filters (`DeviceToolbar` + `Chip`):** a
        chip row groups the grid by `Off` / `Room` / `Type` with **two-level
        subgroups** (room→type and type→room), each (sub)group headed + counted;
        plus multi-select chip rows to filter by type and by room. Empty
        (sub)groups never render. Pure, unit-tested helpers in `lib/devices.ts`
        (`groupDevices` → nested `DeviceGroup[]`, `filterByTypes`,
        `filterByRooms`, `roomOptionsOf`, `deviceTypesOf`, `typeLabel`); state +
        derived `groups`/`filteredDevices`/`typeCounts`/`roomOptions` in the
        store, which also loads `GET /rooms`.
  - [x] **Device search (`searchDevices`):** search box right of the filters —
        loose, multi-term, case/accent-insensitive matching across name,
        description, room, type and subtype; updates per keystroke. A non-blank
        query bypasses (and hides) the chip filters and searches all enabled
        devices; grouping still applies.
  - [x] **Command palette (⌘K, `CommandPalette` + `useCommandPalette`):**
        Raycast/Notion-style keyboard-first modal — search a device, ↑/↓ select,
        ↵ to drill into its quick actions (from `deviceActions(device)`), ↵ to
        run (optimistic + toast); Esc/⌫ steps back, Esc/click-outside closes.
        Results are a flat `PaletteItem[]`; the root now lists "Run scene: …"
        items first (one ↵ = run) then devices. Header trigger button for
        discoverability.
  - [x] **Scenes: `useScenesStore` + `SceneBar`:** scene buttons pinned above the
        device grid (`SceneBar`). One tap runs the scene (`POST /scenes/:id/execute`,
        `source: "ui"`); a spinner shows while it runs, driven by the
        `scene:started`/`scene:completed`/`scene:failed` WS events (routed from the
        devices socket into the scenes store). Visible scenes follow the grid's
        room filter + search (all by default; a room filter narrows to that room;
        a search matches across all) via pure helpers in `lib/scenes.ts`
        (`filterScenesByRooms`, `searchScenes`). Each button has a description
        tooltip and a Lucide icon mapped from the DB `icon` name (`sceneIcon`,
        falling back to a generic icon) so scenes use the same icon set as the
        device widgets. Scenes are also runnable from the command palette.
  - [x] **Command confirm/rollback:** `sendCommand` is optimistic but now awaits
        `device:command:ack` and returns `Promise<boolean>` — on `success:false`
        it rolls back the optimistic patch (`snapshotState`/`applyRevert`) and
        shows an error toast; on success it adopts any authoritative `state`.
        Per-device FIFO; a dropped socket resolves outstanding commands as failed.
  - [x] **Schedules monitor (read-only, `/schedules`):** a `useSchedulesStore` +
        `SchedulesView` that lists every *enabled* schedule with its upcoming run
        times, soonest first. Loads `GET /schedules` + a per-job `GET
        /schedules/:id/next` preview; **monitoring only** — no create/edit/toggle
        (that's admin). Times arrive in UTC and are rendered in the viewer's local
        zone (display-side conversion) via pure, tested helpers in `lib/schedules.ts`
        (`formatDateTime`, `formatRelative`, `nextRunOf`, `sortByNextRun`). No WS
        event exists for schedules, so the view re-fetches on an interval and ticks
        a `now` clock so relative labels stay fresh. Sidebar entry +
        route-`meta` header title.
  - [x] **Camera streaming (RTSP → HLS on demand):** CCTV cameras stream over
        RTSP, which browsers can't play, so the server transcodes RTSP → HLS with
        `ffmpeg` **only while a camera is being watched** (one process per viewed
        camera, never 24/7). New `cameras` table (`url` is the RTSP base *without*
        credentials; `username`/`password` stored separately, injected at ffmpeg
        spawn time, never serialised to the browser or logs — `CameraDTO` strips
        them). `core/StreamManager.ts` owns the lifecycle: first playlist request
        spawns ffmpeg (`-an`, `-c:v copy`, rolling HLS window); each
        playlist/segment fetch resets an idle timer, so when the viewer leaves
        (explicit stop or no more fetches for `STREAM_IDLE_TIMEOUT_MS`) the process
        is killed and its dir cleaned; an unexpected ffmpeg exit drops the session
        (→ 503). Routes `GET/POST/PUT/DELETE /api/v1/cameras`,
        `GET …/:id/stream.m3u8` (auto-start), `GET …/:id/seg/:file` (regex-guarded
        against traversal), `POST …/:id/stop`; the high-frequency stream GETs skip
        the request logger (the StreamManager logs lifecycle events instead).
        Front-end: lazy-loaded `views/CameraView.vue` (hls.js, native HLS on
        Safari) — starts on mount/route change, tears down + `sendBeacon`-stops on
        unmount/`pagehide`; no audio, no controls. New `useCamerasStore`,
        `lib/cameras.ts` (tested) and a structured `lib/logger.ts` for FE logging;
        sidebar "Cameras" section. `spawn`/clock injectable → 21 server + 7 FE
        tests, all hermetic (no real ffmpeg). DB migration `0004_cameras` + seed
        rows. Admin CRUD page landed at `/admin/cameras` — see the Admin pages
        list above.
  - [x] **`driver-generic-trigger` — TCP/UDP/OSC "send a message" without writing
        a driver:** the requested shortcut for one-off protocol messages (e.g. an
        OSC cue to QLab) that don't warrant a bespoke driver package. One
        connection (`host`/`port`, optional `txDelimiter`/`responseTimeoutMs` for
        TCP) and any number of **buttons**, each firing one predefined message;
        TCP opens a socket, writes, closes, UDP/OSC just sends a datagram — no
        subscriptions, no discovery, no persistent connection to probe (so
        `connect`/`healthCheck` always report online rather than lie about UDP).
        Three endpoint types (`generic-trigger.tcp`/`.udp`/`.osc`) share the fifth
        generic `WidgetBinding` kind, **`buttons`** (see "Driver-agnostic widgets"
        above) — proof that the widget system scales to a new driver with zero UI
        changes. The button list is per-device address data
        (`address.buttons[]`, edited via the existing `ArrayObjectField`), not a
        manifest property, so e.g. "QLab Jingles" and "QLab Alarms" can share one
        connection with entirely different button sets, exactly as requested.
        OSC args are free text, auto-typed per token (int/float/bool/string —
        `parseOscArgs`); the OSC encoder was promoted from
        `apps/server/test/input/osc-encode.ts` into `@gallery/driver-core/src/osc.ts`
        so it sits next to the existing OSC *decoder* (`input/osc.ts`) instead of
        being duplicated. 15 driver tests (in-process mock TCP/UDP servers) + 9
        `driver-core` OSC tests + 4 new `buttonsFor` UI tests. Seed example: one
        `generic-trigger` UDP connection ("QLab (sál)") with two devices sharing
        it, "Qlab Jingles" and "Qlab Alarms".
  - [x] **`select` options without live state (`connectionOptions`):** found
        while wiring the command palette's `buttons` action (above) — the
        palette's select actions, and it turned out the on-screen widget too,
        showed zero options for any Extron matrix device, because nothing in
        the server ever automatically calls a poll-only driver's `readState()`
        after connect (the one public `DeviceManager.readState()` method is
        only ever invoked from tests). Input labels are static per-connection
        config, not live device data, so routing them through a state update
        that may never happen was the wrong design from the start. New
        `SelectWidgetBinding.connectionOptions` (`{labelsKey, countKey,
        fallbackLabel, includeNone?}`) builds the option list straight from
        `connection.config` — available the instant the connection is saved,
        with zero dependency on the driver ever connecting. `driver-extron-matrix`
        dropped its `computeOptions`/state-stamping entirely; its manifest
        gained `outputs?: string[]` alongside the existing `inputs?: string[]`
        (documentation for picking an output number when creating a device).
        Deliberately kept scope to one-output-per-device (no bundling multiple
        outputs into one widget) rather than a bigger address-shape change.
  - [x] **Same fix, one layer up — the admin device form:** picking an output
        number was a bare number input, so the admin had to remember which
        output physically was which. New `JsonSchema.connectionEnum`
        (`{labelsKey, countKey, fallbackLabel}`) on any `number`/`integer`
        address property — `schemaToFields()` resolves it (via the same
        `buildConnectionOptions` the widget fix above uses) into a labeled
        dropdown once a connection is picked, while the field's `kind` stays
        `'number'` so validation/coercion are untouched; `SchemaFields.vue`
        just renders that field differently. `driver-extron-matrix`'s
        `output` address field uses it (`labelsKey: "outputs"`); seed gained
        `config.outputs` on the Extron connection, derived from the existing
        `EXTRON_OUTPUT_NAMES` list so the two can't drift apart.
  - [x] **Fix: editing a device showed the output dropdown's placeholder
        instead of its saved value.** `SchemaFields.vue` bound the Select to
        `value as string` — a compile-time-only cast — but a `number`-kind
        field's value is a real JS number once seeded from a saved record
        (`address.output: 6`), so `6 !== "6"` against the SelectItem's string
        value and the trigger fell back to the placeholder. Never showed up
        on create, where the value only ever came from the Select's own
        `@update:model-value` (already a string). New exported
        `selectValueOf()` in `lib/schemaForm.ts` does a real `String()`
        conversion; unit-tested directly, plus verified live against an
        existing seeded device.
  - [~] Remaining shared stores: [x] system, [x] logs, [x] drivers · [ ] layout
  - [x] **`/admin/workflows`** (`views/admin/WorkflowsView.vue` +
        `views/admin/WorkflowSceneView.vue`) — a 2D canvas view over data the
        Mappings/Schedules/Scenes pages already manage, not a new automation
        engine. A Vue Flow "routing map": trigger nodes for `input_mappings`/
        `scheduled_jobs` connect to `scene`/`device` target nodes (drawing a
        connection calls the same store `update()` the existing forms use;
        double-clicking a trigger opens the existing `MappingFormDialog`/
        `ScheduleFormDialog` rather than a second form). Double-clicking a
        scene node drills into `/admin/workflows/scenes/:id`, laying that
        scene's actions out as "stage" columns — one per distinct
        `parallelGroup`. Deliberately no action-to-action edges:
        `SceneEngine.planGroups` only has group barriers, not per-action
        dependencies, so a connecting line would claim a dependency that
        isn't real; dragging a node across columns re-groups it instead. The
        only new persisted concept is a `position: jsonb` column on
        `scene_actions`/`input_mappings`/`scheduled_jobs`
        (`packages/types/src/canvas.ts`, migration `0007`) — reads, target
        rewiring, and action edits (`SceneActionRow` reused as the node
        inspector) all go through the existing repos/routes/stores.
        Unpositioned nodes auto-layout with `@dagrejs/dagre`. New pure
        `lib/workflowGraph.ts` (unit-tested) builds both graphs from data the
        mappings/schedules/scenes/devices stores already hold.
  - [x] **`trigger_actions` redesign — optional targets, N actions per
        trigger.** Follow-up to the routing map above: `scheduled_jobs`/
        `input_mappings` no longer carry a target at all (dropped
        `scene_id`/`target_type`/`target_id`/`target_command`/
        `params_template`) — a schedule or mapping is now a pure "when" row,
        valid and savable with zero actions wired to it. What runs lives in a
        new `trigger_actions` table (mirrors `scene_actions`'s shape: a
        one-to-many child with an XOR-FK CHECK constraint, here
        `schedule_id`/`mapping_id`), giving each trigger 0..N actions that
        each independently target `scene.execute` or `device.command`;
        `event.emit` was dropped from `TriggerTargetType` — a trigger action
        runs a scene or a device command, nothing else. An unwired action
        (dropped on the canvas before a target is picked) is a normal, valid
        row; the dispatcher just skips it at fire time.
        - New shared `TriggerActionDispatcher` (`core/TriggerActionDispatcher.ts`)
          is the single place a `trigger_actions` row becomes a real effect,
          used by both `Scheduler` (literal params, fetched fresh from the
          repo on every cron fire — no cache to invalidate on a wiring edit)
          and `InputMapper` (params template-evaluated against the ingress
          signal's args/path params, cached alongside the mapping and
          reloaded on a mapping- or trigger-action edit). Template evaluation
          moved out of `input/patterns.ts` into a new shared
          `core/templating.ts` since both dispatch paths need it now, not
          just `InputMapper`.
        - New `triggerActionsRepo` + REST `/api/v1/trigger-actions` (CRUD),
          with an owner-XOR-target-type validation that mirrors the DB CHECK
          constraint; a given `targetId` must resolve to a real scene/device,
          but an absent one is accepted (unwired). `/mappings` and
          `/schedules` routes dropped their target validation entirely.
        - Canvas is now a 3-tier graph — trigger → its 0..N trigger-action
          nodes → each action's resolved target — instead of the earlier
          2-tier trigger → target. Dragging a connection **straight from a
          trigger to a target** auto-creates and wires a new trigger action in
          one gesture (so routing one schedule to several scenes/devices is N
          drag gestures, not N clicks through a form); dragging from an
          existing action node to a target just rewires that one action. A
          "+" under every trigger creates a bare, unwired action and selects
          it so the inspector opens for picking a target by hand. Scenes are
          always shown as target nodes (bounded, admin-managed list) so one
          can be wired up before any trigger points at it yet; devices only
          appear once some action already targets them (avoids cluttering the
          canvas with every device up front — a new device target is picked
          via the inspector's Select, and its node appears once wired).
        - **The canvas is now the only place a trigger/action's fields get
          set** — `MappingFormDialog`/`ScheduleFormDialog` are deleted, per
          the explicit design call to replace them with the canvas's own
          right-sidebar inspector (new `TriggerInspector.vue` for
          name/enabled/protocol+pattern or cron+timezone, and
          `TriggerActionInspector.vue` + `TriggerActionDeviceFields.vue` for
          target type/scene or device+command/params). The Mappings/Schedules
          admin list pages are now pure monitoring + toggle + delete; their
          "New"/"Edit" actions navigate to `/admin/workflows` (Edit via
          `?select=<nodeId>` to pre-select the row's node and open its
          inspector). The user-facing `/schedules` monitoring page now lists
          every wired trigger action's summary per schedule instead of a
          single scene name, since a schedule can fire more than one action.
  - [x] **Canvas UX redesign — edges instead of action nodes, drag-and-drop
        library, persisted target positions, widget-based params.** Follow-up
        to the 3-tier canvas above, from direct admin feedback on it: the
        action-node tier is gone, `position` moved from `trigger_actions` to
        `scenes`/`devices` (migrations `0009`, `0010`), and raw-JSON param
        editing became typed widgets.
        - `lib/workflowGraph.ts`'s `buildRoutingGraph` is now a 2-tier graph:
          one node per trigger and per placed-or-wired target, one **edge**
          per `trigger_action` connecting a trigger straight to its target.
          The action has no node of its own — its id and full row travel as
          the edge's `data`, so selecting the edge (`@edge-click`) is how
          `TriggerActionInspector` opens, the same way selecting a node
          always has. Because an edge needs both endpoints to exist, a
          `trigger_action` can no longer be created unwired — drawing a
          connection from an already-visible trigger to an already-visible
          target *is* what creates it, atomically wired. `TriggerActionNode.vue`,
          `TriggerActionDeviceFields.vue`, and the routing map's "+" buttons
          (`addActionNodeId`/`parseAddActionValue`) are deleted; the scene
          stage canvas's own unrelated "+" buttons are untouched.
        - New `position: jsonb` column on `scenes`/`devices` (migration
          `0009`), threaded through their create/update routes/repos exactly
          like every other positioned row; `trigger_actions.position` (no
          longer meaningful — nothing renders it as a node) is dropped
          (migration `0010`). A scene/device only renders as a canvas node
          once it has a saved `position` *or* some `trigger_action` already
          targets it (`unplacedLibraryItems` is the complementary set) — this
          also fixes the pre-existing bug where an auto-shown, unpositioned
          target's dragged position never persisted (there was no column to
          save it to before this).
        - New left-sidebar **library panel** (`LibraryPanel.vue` +
          `LibraryList.vue`) lists every scene/device not yet on the
          canvas as an HTML5-draggable card (`lib/libraryDrag.ts` — a tiny
          `dataTransfer` wire-format shared by the drag source and the
          canvas's drop handler). Dropping one onto the pane converts the
          drop's screen position to flow coordinates
          (`useVueFlow().project()`, adjusted for the pane's own bounding
          rect) and saves it as that scene/device's `position` — which is
          what makes `buildRoutingGraph` start rendering it, so a trigger can
          then be wired to it. Placing a target is now strictly separate from
          wiring one, per the explicit design ask.
        - `TriggerActionInspector.vue` no longer has target-type/target
          Selects (both are fixed by the edge that created the action, shown
          as a read-only summary; changing them means deleting the action and
          drawing a new connection) or a raw-JSON params textarea. A
          `device.command` action's params render as typed widgets resolved
          from the command's schema (`schemaToFields` — boolean → Switch,
          enum → Select, number/string → Input), split into
          `TriggerActionParamField.vue`/`TriggerActionEnumSelect.vue` to keep
          the per-kind widget switch from ballooning the parent's branching
          (`fallow audit`-driven: CRAP 306 critical → 20-42 range). A
          mapping-owned action additionally gets a per-field "From
          signal"/"Use a value" toggle to reference the firing signal
          (`{arg[0]}`/`{:name}`) instead of a literal value — defaulted on if
          the stored value already looks like a token — never shown for a
          schedule-owned action (no signal to reference).
        - Fan-out (one trigger, several targets) and fan-in (several triggers,
          one target) both keep working exactly as before: each is just an
          independent edge, nothing gates how many can share a source or
          target.
  - [x] **Unlimited-instances redesign — `workflow_targets`, click-node
        wiring, signal-arg hover, Slider widget.** Follow-up to the edge-based
        canvas above, from direct admin feedback on it: a scene/device is a DB
        singleton, but the canvas needed independently-placed,
        independently-configured *instances* of one — e.g. the same device
        twice, once wired "on" and once "off" — which `position`-on-`scenes`/
        `devices` couldn't represent (one row, one node, one config).
        - New `workflow_targets` table (migrations `0011`–`0013`, staged
          add/backfill/finalize since drizzle-kit's rename-heuristic prompt
          can't run non-interactively when a diff both adds and drops
          same-named columns in one pass) is the placed instance: `targetType`/
          `targetId`/`targetCommand`/`params` moved here from
          `trigger_actions`, and `position` moved here from `scenes`/`devices`
          (dropped there entirely — a scene/device is no longer a canvas node
          in its own right, only through however many `workflow_targets` rows
          reference it). Unlike a trigger, `position` here is `NOT NULL`:
          existence on this table *is* placement, so `buildRoutingGraph`
          renders every row unconditionally, no "unplaced" filter to speak of.
          `trigger_actions` is trimmed to a pure link (`id`, `scheduleId`
          XOR `mappingId`, `workflowTargetId`) — no more per-row command/
          params, so a schedule/mapping can now wire to two different
          instances of the same device with two different commands, and the
          old "unwired action" state (`targetId IS NULL`) is impossible by
          construction (`workflowTargetId` is a `NOT NULL` FK).
        - Dispatch reads a joined `DispatchableTriggerAction` shape (`id` +
          the wired target's `targetType`/`targetId`/`targetCommand`/`params`)
          assembled via SQL JOIN in `triggerActionsRepo`
          (`listDispatchableByScheduleId`/`listDispatchableByMappingIds`),
          not native columns — `TriggerActionDispatcher`'s old "not wired to a
          target" branch is now dead code and was deleted along with it.
        - **Clicking a target node — not the edge — opens its inspector**
          (renamed `TriggerActionInspector` → `WorkflowTargetInspector`),
          since command/params now live on the instance. The edge itself is a
          custom Vue Flow component (`TriggerActionEdge.vue`) that opens
          nothing on click; hovering (or selecting) it shows a floating
          tooltip with the named path-params its owning mapping's pattern
          captures (`patternParamNames`, a client-side mirror of
          `input/patterns.ts`'s split algorithm) and an inline delete button.
          The same params surface in the target's own inspector as "Available
          from signal: …" — the deduped union across every incoming
          mapping-owned wire (`hasSignalWire`/`availableArgs`, computed once
          in `buildRoutingGraph` and carried on the target node's data).
        - Left-sidebar **library panel now always lists every scene/device**,
          full stop — `unplacedLibraryItems` is deleted; dropping a card
          always creates a **new** `workflow_targets` row (never moves an
          existing one), so the same scene/device can be placed any number of
          times. `TargetNode.vue`'s subtitle shows the *instance's own*
          configured command (or "Pick a command…"), not the device's generic
          type, so two instances of one device read as visibly distinct.
        - Bounded number params (`minimum`+`maximum` both declared, e.g. a
          0..1 fader level) render as a `Slider` instead of a plain number
          `Input` — `schemaToFields` gained `minimum`/`maximum`/`step` fields,
          consumed by both the target inspector's param field
          (`WorkflowTargetParamField.vue`, renamed from
          `TriggerActionParamField.vue`) and the pre-existing scene-action
          editor (`SceneActionRow.vue`), sharing the same schema-derived
          bounds.
        - Playwright verification against the live app caught a real bug the
          type-checker and unit tests couldn't: the edge's delete button
          called `store.remove(props.id)`, but `id` is the edge's namespaced
          Vue Flow id (`trigger-action:<uuid>`), not the trigger-action row's
          own id — every inline wire-delete 500'd. Fixed to use
          `data.triggerAction.id`. Also hardened the hover overlay to stay
          open while the pointer is over the floating button itself (a
          separate DOM subtree from the edge's own hover target), not just
          the edge path, so moving onto the button to click it can't hide it
          first.
  - [x] **Multi-select, keyboard shortcut, and library-search fixes.** Direct
        feedback on the canvas's interaction feel, all verified against the
        live app (Playwright caught the first one — the type-checker had
        nothing to say about it):
        - `onNodeDragStop` was reading the single `event.node` (whichever the
          pointer grabbed) and only persisting that one's position. Vue Flow
          already *moves* every multi-selected node together when you drag
          one; the bug was that only the grabbed node's new spot got saved,
          so the rest snapped back to their last-saved position on the next
          reactive rebuild. Fixed to iterate `event.nodes` (every node that
          actually moved) and persist each one — confirmed by reloading after
          a group drag and seeing every node stay put, not just the one.
        - Box-select-by-dragging-a-rectangle now holds **Cmd/Ctrl**
          (`:selection-key-code="['Meta', 'Control']"`) instead of Vue Flow's
          default Shift — confirmed Shift+drag no longer selects anything and
          Ctrl+drag selects both nodes in a rectangle.
        - **Return/Enter deletes the active node**, calling the exact same
          function its inspector's own trash button does
          (`TriggerInspector`/`WorkflowTargetInspector` now `defineExpose`
          their `remove()`, called via a template ref from `WorkflowsView`'s
          window-level `keydown` listener) rather than duplicating the
          deletion logic. Guarded against firing while focus is in an input/
          textarea/select/button/contenteditable — confirmed pressing Enter
          to submit the trigger name form saves instead of deleting, and
          pressing it with the canvas focused deletes the selected node and
          closes its inspector.
        - New search box in the library panel filters both the Scenes and
          Devices sections by name, reusing the device-grid/scene-list
          search primitives (`lib/text.ts`'s `searchTerms`/`normalize`/
          `matchesAllTerms`) instead of a one-off substring match, so
          diacritic-folding and multi-term matching behave the same
          everywhere search exists in the app. Empty-state copy
          ("All scenes are on the canvas") was stale from before the
          library-always-shows-everything redesign — fixed to distinguish
          "nothing exists yet" from "nothing matches the search."

See README §5, §10–11 for full spec; see §11 for the implemented slice.

---

## Priority 6 — Authentication & Security ✓

⚠️ **PLAN correction:** this section originally sketched JWT middleware on
`Bun.serve`, a fixed `admin`/`operator`/`viewer` role enum, and an
`AUTH_ENABLED` escape hatch. None of that shipped. The actual requirement
(clarified directly) was much narrower — stop staff from casually touching
devices that aren't theirs, and keep the public out of a kiosk until it's
unlocked — not a hardened security boundary. So:

- [x] **`roles` + `users` tables** (`packages/types/src/schema.ts`) — a role
      has a name, an `isAdmin` flag (full admin portal + every device), and
      an optional description. A user has a username (unique), an
      argon2id-hashed password (`Bun.password`, native, no new dependency),
      a `roleId`, a display name, and `enabled`.
- [x] **`role_devices`** — a plain n:n join table (not an enum, not a column
      on `devices`) recording which devices a non-admin role may see in the
      User UI. Empty = sees nothing; admin roles bypass it entirely.
- [x] **`POST /api/v1/auth/login`** — a one-shot credential check
      (`apps/server/src/api/routes/auth.ts`). Returns the user + role
      (`id`/`name`/`isAdmin`, no `deviceIds`) on success. **No cookie, no
      token, no server-side session** — the frontend just remembers this
      locally (`useAuthStore`, persisted to `sessionStorage`) to decide what
      to render (which admin sections are reachable). The HTTP API and
      `/ws` stay exactly as open as every other route in this codebase —
      the same trust level already accepted for OSC/TCP ingress. This is a
      front-end convenience gate, not a hardened auth boundary; documenting
      that plainly here so it's a design decision, not a hidden gap.
- [x] **Users/Roles CRUD** (`api/routes/users.ts`, `roles.ts`) — admin-only
      by convention (nothing enforces it server-side, matching the point
      above); no self-registration, admin creates every account.
- [x] **Router guard** (`apps/ui/src/router/index.ts` + `lib/router.ts`,
      pure/unit-tested) — every route except `/login` and the kiosk viewer
      requires a logged-in user (checked against the local `useAuthStore`
      state); `meta.admin` routes additionally require `role.isAdmin`.
- [x] **Device visibility, decided server-side** — `GET /devices` and `GET
      /devices/live` accept `?role_id=`; `filterByRole`
      (`api/routes/devices.ts`) scopes the returned list to that role's
      `role_devices` (admin or no `role_id` → everything, unchanged).
      `useDevicesStore.fetchAll()` passes `auth.role?.id` on every fetch, so
      the server — not a client-side cache — decides what comes back. This
      replaced an earlier client-side `canSeeDevice` filter plus a
      `refresh()`/polling mechanism: that design cached the role's
      `deviceIds` in `useAuthStore` at login time, which went stale the
      moment an admin edited the role afterwards (a real reported bug — a
      barista granted devices mid-session saw nothing until an explicit
      logout/login). Filtering server-side on every fetch instead means a
      plain page reload is always correct, with nothing cached to go stale
      and no timer to maintain. The WS broadcast is still untouched (one
      shared topic to everyone) — a device the frontend never kept a record
      for is simply a no-op when its `device:state` update arrives.
- [x] **Inactivity auto-logout** — client-side only (`useIdle` from
      `@vueuse/core`, first real use of it here), timeout minutes
      admin-configurable from Settings → Security, persisted through the
      previously-unused `config` key/value table via `GET/PUT
      /api/v1/settings/security`.
- [x] **Kiosk PIN** — `kiosks.pin` (nullable, plain digits — a front-end
      lock, not a credential, so deliberately not hashed). `KioskView.vue`
      compares the entered PIN locally; no backend call for the check
      itself. Unlock state persists in `sessionStorage` per kiosk id.
      Fixed a real pre-existing bug in the same file while adding this: the
      admin Layouts/Builder pages always linked to the viewer by the
      kiosk's **name**, but the viewer looked itself up by **id** — so
      "Open viewer" 404'd before this change. Now uses `GET
      /kiosks/by-name/:name` (already existed server-side, just wasn't
      wired into the viewer) and the route param is `:name`, not `:id`.
- [x] **Bootstrap admin** — the seed script creates one Admin user from
      `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars (`admin`/`admin` if unset),
      no forced password change.
- [x] Usernames are threaded into `scene:execute`'s existing `source` field
      and a new optional `username` on `device:command`, for server log
      tracing only — not an enforcement identity.

**Deliberately not built** (explicit scope decisions, not oversights): no
session/cookie machinery, no auth middleware on any route, no per-role
read/write split (if a role can see a device, it can control it), no
per-scene device visibility beyond what a scene's own `visibleRoles`-style
column would need (not added — out of the stated scope), no CSRF handling,
no admin "active sessions" view, no `AUTH_ENABLED` flag.

---

## Implementation order (critical path)

```
Step 0   Watchdog + DB log transport + Logs API
Step 1   driver-template
Step 2   driver-bss-soundweb
Step 3   driver-dali (Lunatone)
Step 4   driver-extron-matrix + driver-samsung-mdc
Step 5   driver-vmix
Step 6   Scene repositories + SceneEngine
Step 7   Scenes REST API + WS scene:execute
Step 8   Scheduler + Schedules API
Step 9   InputMapper + TcpInputServer + Mappings API
```

---

## Pending design decisions

These items from the codebase review need a call before anyone starts coding.
Each is labelled **[DECIDE]** in the original refactor analysis.

### D1 · Manifest reserved fields — keep or remove?
`CommandDefinition` (`driver-core/src/types.ts`) carries `reversible` and
`estimatedDurationMs`. Rollback/choreography was dropped (PLAN §2); nothing
reads these fields today. Every driver manifest fills them for nothing.
**Options:** remove from the type + all manifests, or add a `// reserved for
rollback (PLAN §2, not implemented)` comment and leave.

### C3 · Split ownership of live status (DeviceManager vs Watchdog)
Both `DeviceManager` and `Watchdog` write `connection:{id}:status` and emit
`connection.connected/disconnected`; likewise for `device:{id}:status`. They
can briefly disagree and double-emit.
**Proposed split:** DeviceManager owns the *transport* transition (socket
open/close); Watchdog owns *liveness re-confirmation* and only emits on a
real change (no double-emit). Needs explicit sign-off on which module emits
what, then document it in both files.

### E4 · Single shared WebSocket (currently two connections opened)
Per README/PLAN the UI uses a single `/ws` connection. Reality: `realtime.ts`
was introduced to centralise this, but confirm in the network panel that only
one `/ws` connection is visible when both `useDevicesStore` and
`useConnectionsStore` are mounted. If two still open, move ownership entirely
into `useRealtimeStore` and have both stores subscribe to it.

### H1 · DALI brightness logic placement — driver or core? ✓ RESOLVED
Decided **(a)**: moved into the DALI drivers, as part of the driver-agnostic
widget rewrite (see "Driver-agnostic widgets" under Priority 5). Each DALI
driver (`DaliLunatoneDriver`/`DaliFoxtronDriver`) now remembers a fixture's
last known non-zero brightness itself via its per-connection KV store
(`ctx.storage`) and substitutes it in `readState`/command echoes whenever the
fixture reports off — `redis/state.ts`'s `mergeDeviceState` is back to a plain
shallow spread with no vendor-specific rules. Covered by each driver's own
tests (`test/lunatone.test.ts`, `test/foxtron.test.ts`), including survival
across a driver restart.

### G7 · apps/ui vs packages/ui — resolve before building admin UI
README §3 depicts a shared `packages/ui` component library. Reality is a
single `apps/ui` with `components/ui/` inside it, no `packages/ui`.
**Options:** (a) keep one `apps/ui` with route-based admin/user layouts
(simplest; matches current trajectory); (b) split into `apps/ui` (user) +
`apps/admin` (or `packages/ui` shared lib). Decide and update the README
so the next builder isn't misled. Must be decided before admin UI work starts.

### A6 · Route manifest / shared API contract in `@gallery/types`
The typed `api` client (`apps/ui/src/lib/api.ts`) exists and covers the
current routes. Before the admin UI adds many more calls, decide whether to
introduce a **shared route-contract object** in `@gallery/types` (method + path
+ input type + output type) that both the server's router and the UI client
reference — so a route signature change is a compile error on both sides.
**Options:** (a) keep the hand-written typed client as-is (light, no extra
abstraction); (b) add a route manifest to `@gallery/types` and derive the
client from it. Avoid heavy frameworks (tRPC/OpenAPI codegen) without sign-off.

### G9 · Broadcast topic separation (forward-looking, for auth/admin)
Every client receives all events on the single `events` topic, including
`driver:error` and scene internals. Fine today (no auth, user panel only).
When the admin UI + auth (P6) arrive, user-panel clients probably shouldn't see
admin-only events. **No action now** — design topic/role separation when auth
lands. Note here so it isn't forgotten.

---

## New files at a glance

```
apps/server/src/
  core/
    Watchdog.ts
    SceneEngine.ts
    Scheduler.ts
  input/
    TcpInputServer.ts
    InputMapper.ts
  db/
    log-transport.ts
  api/routes/
    scenes.ts
    schedules.ts
    mappings.ts
    logs.ts

packages/drivers/
  driver-template/
  driver-bss-soundweb/
  driver-dali/
  driver-extron-matrix/
  driver-samsung-mdc/
  driver-vmix/
```
