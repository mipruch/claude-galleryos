# GalleryOS — Backend Feature Plan

Branch: `feat/backend-features`  
Priorities: Drivers → Scenes → Scheduling → TCP Ingress → UI (later) → Auth (later)

Mark items `[x]` as they are implemented and tested.

---

## Already done (core)

- [x] driver-core: `IDeviceDriver` contract, IPC protocol, `TcpClient` transport
- [x] `driver-pjlink` — PJLink Class 1 (auth, on/off/input/mute/readState)
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

### 1.4 `driver-extron-matrix` — Extron video matrix (SIS / TCP 23)

**Protocol** (ASCII, CR-terminated):
- `{in}*{out}!` — tie input to output (video)
- `{in}*{out}%` — tie input to output (audio)
- `I{out}` — query current video input for output
- State: poll on connect and after each tie command

**Endpoint type:** `extron-matrix.output`  
**Address:** `{ output: 1..n }`  
**Commands:** `setInput { input: number }`, `setAudioInput { input: number }`, `readState`

- [ ] `ExtronMatrixDriver.ts`
- [ ] Register in registry

### 1.5 `driver-samsung-mdc` — Samsung MDC (TCP 1515)

**Protocol** (binary):
- Frame: `0xAA | cmd(1) | displayId(1) | len(1) | data[len] | checksum(1)`
- `0x11` — power on/off
- `0x14` — input source select
- `0xF9` — status query (power + input in one response)

**Endpoint type:** `samsung-mdc.display`  
**Address:** `{ displayId: 1..255 }`  
**Commands:** `on`, `off`, `setInput { input: "HDMI1"|"HDMI2"|"DVI"|"DP"|"VGA" }`, `readState`

- [ ] `SamsungMdcDriver.ts`
- [ ] Register in registry

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

Redis key additions to `src/redis/state.ts`:
- [x] `redisSceneStore`: `setSceneActive(sceneId)`, `clearSceneActive(sceneId)`, `isSceneActive(sceneId)` (`scene:{id}:active`)

### 2.3 Scenes REST API `src/api/routes/scenes.ts` ✓
- [x] `GET    /api/v1/scenes` — `?room_id= &is_favorite= &tags=`
- [x] `POST   /api/v1/scenes` — `{ name, roomId?, description?, icon?, color?, tags?, actions[] }` (actions validated)
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

## Priority 3 — Scheduling

**Timezone handling:** `Bun.cron` runs in UTC only. For per-job timezones, compute the next UTC fire time using `Temporal.ZonedDateTime` (built into Bun) and schedule via `setTimeout`. After each fire, recompute the *next* occurrence — this handles DST transitions correctly because the offset is recalculated fresh each time rather than assumed constant.

Example: a job set to `0 9 * * *` in `Europe/Prague` fires at 08:00 UTC in winter and 07:00 UTC in summer. Recomputing after each fire always gives the correct next UTC timestamp regardless of which side of a DST boundary we're on.

### 3.1 `Scheduler` `src/core/Scheduler.ts`
- [ ] On `start()`: load all enabled `scheduled_jobs` from DB; schedule each
- [ ] `scheduleJob(row)`:
  - Parse cron expression (validate it's a valid 5-field expression)
  - Compute next UTC fire time using `Temporal.ZonedDateTime.from({ ...parsed, timeZone })` + cron logic
  - Schedule via `setTimeout` to that UTC timestamp
  - After each fire: call `SceneEngine.executeScene(sceneId, 'scheduler')`, update `last_run_at` + `next_run_at` in DB, reschedule
- [ ] On startup: compare `next_run_at` vs `NOW()` — if a job should have fired and didn't, log a warning (do not auto-run)
- [ ] Dynamic API: `addJob(row)`, `removeJob(id)`, `reloadJob(id)` — used by schedules REST controller
- [ ] `stop()` — cancel all pending timeouts gracefully
- [ ] Wire into `src/api/context.ts` and `src/index.ts`

### 3.2 Next-runs helper
- [ ] `computeNextRuns(cronExpr, timezone, count)` — pure function returning next N UTC timestamps
- [ ] Used by `GET /schedules/:id/next` and displayed in the Admin UI later

### 3.3 Schedules REST API `src/api/routes/schedules.ts`
- [ ] `GET    /api/v1/schedules`
- [ ] `POST   /api/v1/schedules` — `{ name, sceneId, cron, timezone, enabled }`
- [ ] `GET    /api/v1/schedules/:id`
- [ ] `PUT    /api/v1/schedules/:id` → `Scheduler.reloadJob()`
- [ ] `DELETE /api/v1/schedules/:id` → `Scheduler.removeJob()`
- [ ] `PATCH  /api/v1/schedules/:id/toggle` — enable/disable without delete
- [ ] `GET    /api/v1/schedules/:id/next` — next 5 fire times (preview, uses `computeNextRuns`)

---

## Priority 4 — TCP Ingress

### 4.1 `InputMapper` `src/input/InputMapper.ts`
Shared logic, used by TcpInputServer (and future OSC server):
- [ ] Pattern matching: exact (`/scene/execute`) and parameterised (`/dim/:level`)
- [ ] Template evaluation: replace `{arg[0]}`, `{arg[1]}`, `{:level}` with extracted values
- [ ] In-memory DB cache of enabled mappings, with `reload()` called by mappings CRUD

### 4.2 `TcpInputServer` `src/input/TcpInputServer.ts`
- [ ] `Bun.listen` on `TCP_INPUT_PORT` (8766); persistent connections, newline-delimited JSON frames
- [ ] Per message: emit `input.tcp.received`; look up matching mappings via `InputMapper`; dispatch:
  - `scene.execute` → `SceneEngine.executeScene`
  - `device.command` → `DeviceManager.execute`
  - `event.emit` → `EventBus.emit`
- [ ] Wire into `src/index.ts`

### 4.3 InputMappings REST API `src/api/routes/mappings.ts`
- [ ] `GET    /api/v1/mappings`
- [ ] `POST   /api/v1/mappings`
- [ ] `GET    /api/v1/mappings/:id`
- [ ] `PUT    /api/v1/mappings/:id`
- [ ] `DELETE /api/v1/mappings/:id`
- [ ] `POST   /api/v1/mappings/test` — `{ protocol, message }` → dry-run match result

---

## Priority 5 — UI (later)

Single Vue 3 app (`apps/ui`) — admin portal and user panel in one Vite project, separated by route-based layouts. Shared Pinia stores, shared components, single WebSocket connection.

- [~] `apps/ui` — Vue 3 + Vite + Pinia + TailwindCSS v4 + shadcn-vue
  - [ ] `AdminLayout` — full-nav shell for `/admin/**` routes
  - [ ] Admin pages: dashboard, rooms, connections, devices, scenes, schedules, mappings, layouts, logs, settings
  - [ ] `UserLayout` — minimal touch-optimised shell for `/app/**` routes, no config UI
  - [x] **User panel — device control slice (no routing yet):** brightness fader,
        BSS fader + mute, on/off switch. Each in a shared `DeviceCard` (title +
        description tooltip + online dot). Widget chosen by driver `subtype`.
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
  - [ ] Remaining shared stores: scenes, system, layout, logs, drivers

See README §10–11 for full spec; see §11 for the implemented slice.

---

## Priority 6 — Authentication & Security (later)

- [ ] `users` table + password_hash
- [ ] JWT middleware on `Bun.serve`
- [ ] Role-based access (`admin` / `operator` / `viewer`)
- [ ] `AUTH_ENABLED=false` env flag keeps current no-auth behaviour

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
