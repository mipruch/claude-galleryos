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

### 0.2 DB log transport `src/db/log-transport.ts`
- [ ] Winston transport that async-inserts into the `logs` hypertable via Drizzle
- [ ] Batch inserts (flush every 500 ms or 50 records, whichever comes first) to avoid write pressure
- [ ] Wire into `src/logger.ts` (`winstonRoot.add(...)`)

### 0.3 Logs REST API `src/api/routes/logs.ts`
- [ ] `GET /api/v1/logs` — `?level=` `?source=` `?entity_id=` `?from=` `?to=` `?limit=` `?offset=`
- [ ] `GET /api/v1/logs/stats` — counts by level for last 24 h / 7 d
- [ ] `GET /api/v1/logs/executions` — scene execution history with outcome + duration

---

## Priority 1 — Drivers

### 1.1 `driver-template`
- [ ] Fully-commented manifest with placeholder JSON schemas
- [ ] Skeleton driver class with `// TODO` guide in every method
- [ ] Template test file (6 standard cases: connect, command, readState, dry-run, unknown-command, disconnect)
- [ ] `mock-device.ts` helper template

### 1.2 `driver-bss-soundweb` — BSS SoundWeb London (HiQnet / TCP 1023)

Simplified implementation: set, get, and subscribe. Full HiQnet network model not needed.

**Protocol** (binary framing):
- Frame: `SOF(1) | len(2) | destAddr(5) | srcAddr(5) | msgType(2) | flags(1) | payload | checksum(1)`
- `SET_VALUE  0x0088` — set a parameter
- `GET_VALUE  0x010F` — request current value (response arrives async)
- `SUBSCRIBE  0x0088` — request push notifications for a parameter
- `UNSUBSCRIBE 0x0089`
- `KEEPALIVE  0x006E` — send every ~15 s to keep socket alive

**Multi-endpoint**: one TCP socket per BSS processor, shared by all faders/mics. Driver maintains `subscriptionKey → endpointId` map to route inbound pushes.

**Endpoint type:** `bss-soundweb.fader`  
**Address:** `{ node: number, virtualDevice: number, object: number, parameter: number }`  
**Commands:** `setLevel (0..1)`, `setMute (bool)`, `readState`  
**Capabilities:** `subscriptions: true`, `bidirectional: true`

- [ ] Binary frame builder/parser (`src/hiqnet.ts`)
- [ ] `BssSoundwebDriver.ts` — connect, keepalive, subscribe on connect, route inbound events
- [ ] Reconnect resubscribes all active endpoints
- [ ] Mock TCP server for tests
- [ ] Register in `apps/server/src/drivers/registry.ts`

### 1.3 `driver-dali` — Lunatone DALI gateway (TCP)

Target: **Lunatone DALI gateway**. Lunatone uses a text-based TCP protocol.

**Protocol** (ASCII, CR-LF terminated):
- `>A {addr} {cmd}<` — send DALI command to address (e.g. `>A 0 DAPC 200<`)
- `>A {addr} QUERY ACTUAL LEVEL<` → response: `>A {addr} YES {value}<`
- Discovery: scan addresses 0–63 with `QUERY ACTUAL LEVEL`; any that respond with a value exist

**Endpoint type:** `dali.fixture`  
**Address:** `{ daliAddress: 0..63 }`  
**Commands:** `on`, `off`, `setBrightness { level: 0..1 }` (→ DAPC 0..254), `recall { scene: 0..15 }`  
**Capabilities:** `discovery: true`

- [ ] `DaliDriver.ts`
- [ ] `discoverEndpoints()` — scan 0-63, return found fixtures
- [ ] Mock Lunatone TCP server for tests
- [ ] Register in registry

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

### 2.1 Scene repositories `src/db/repositories.ts`
- [ ] `scenesRepo.list({ roomId?, isFavorite?, tags? })`
- [ ] `scenesRepo.get(id)` — includes `actions` array ordered by `step_order`
- [ ] `scenesRepo.create(data)` — with initial `scene_actions`
- [ ] `scenesRepo.update(id, data)` — replace actions (delete + insert)
- [ ] `scenesRepo.remove(id)`
- [ ] `sceneActionsRepo.replaceAll(sceneId, actions[])`
- [ ] `sceneExecutionsRepo.create(data)`, `.updateStatus(id, status, durationMs?)`
- [ ] `sceneExecutionsRepo.listByScene(sceneId)`, `.getRunning(sceneId)`

### 2.2 `SceneEngine` `src/core/SceneEngine.ts`
- [ ] `executeScene(sceneId, source, executionId?)` — main entry point
- [ ] **Pre-flight:** load scene + actions from DB; verify devices exist; check `scene:{id}:active` in Redis (reject if set)
- [ ] **DB write:** INSERT `scene_executions { status: 'running' }`; `SET scene:{id}:active 1`; emit `scene.execute.started`
- [ ] **Execution planner:** group actions by `parallel_group`, sort ascending
  - For each group: `Promise.all(actions.map(runAction))` 
  - `delay_ms` honoured via `Bun.sleep` before the command
  - `on_failure: 'abort'` → break remaining groups, fail; `on_failure: 'continue'` → log and move on
- [ ] **Completion:** update `scene_executions`; `DEL scene:{id}:active`; emit `scene.execute.completed/failed`
- [ ] **Dry run:** pass `dryRun: true` flag to DeviceManager (already propagates to driver subprocess)
- [ ] Wire into `src/api/context.ts` and `src/index.ts`

Redis key additions to `src/redis/state.ts`:
- [ ] `setSceneActive(sceneId)`, `clearSceneActive(sceneId)`, `isSceneActive(sceneId)`

### 2.3 Scenes REST API `src/api/routes/scenes.ts`
- [ ] `GET    /api/v1/scenes` — `?room_id= &is_favorite= &tags=`
- [ ] `POST   /api/v1/scenes` — `{ name, roomId?, description?, icon?, color?, tags?, actions[] }`
- [ ] `GET    /api/v1/scenes/:id` — scene + actions
- [ ] `PUT    /api/v1/scenes/:id` — replace scene metadata + actions
- [ ] `DELETE /api/v1/scenes/:id`
- [ ] `POST   /api/v1/scenes/:id/execute` — `{ source? }` → `{ executionId, sceneId, status }`
- [ ] `POST   /api/v1/scenes/:id/execute/dry-run`
- [ ] `GET    /api/v1/scenes/:id/executions`
- [ ] `PATCH  /api/v1/scenes/:id/favorite` — `{ is_favorite: bool }`

### 2.4 WebSocket: scene:execute
- [ ] Wire up `scene:execute` handler in `src/api/ws.ts` (currently stub)
  - Validate scene exists; generate executionId; emit `scene.execute.requested`
  - SceneEngine listens and runs; respond with `scene:execute:ack { executionId }`
  - Subsequent events (`scene:started`, `scene:completed`, `scene:failed`) already broadcast via EventBus bridge

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

Tracked here but not started yet.

- [ ] `apps/admin-ui` — Vue 3 + Vite + Pinia + TailwindCSS + shadcn-vue
- [ ] `apps/user-ui` — same stack, tablet-optimised, no config — driven by `ui_layouts`

See README §10–11 for full spec.

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
