# Running GalleryOS locally

GalleryOS core is a Bun server that talks to AV devices through driver
subprocesses, backed by TimescaleDB (Postgres) + Redis. Bun runs TypeScript
directly, so there is **no build step**.

There are three ways to run it. For day-to-day development use **Option A**.

---

## Prerequisites

- **Bun** ≥ 1.3 — `curl -fsSL https://bun.sh/install | bash`
- **Docker** (Desktop or colima) with the Compose plugin — used for Postgres +
  Redis (and, optionally, to run the server itself).

First-time setup:

```bash
bun install          # install workspace dependencies
cp .env.example .env # local configuration (safe defaults; gitignored)
```

---

## Option A — Local dev (recommended)

Server runs on your host with hot reload; only Postgres + Redis run in Docker.
One command does everything (start infra → migrate → seed → watch):

```bash
bun run dev
```

That runs `docker compose up -d postgres redis`, applies migrations + the
TimescaleDB setup, seeds sample data, then starts the server with `bun --watch`
on **http://localhost:3000**. Edit any file under `apps/server/src` or
`packages/` and it reloads automatically.

Stop the server with `Ctrl-C`. The Postgres/Redis containers keep running; stop
them with `docker compose down` (add `-v` to also delete their data volumes).

`LOG_LEVEL=debug` (the dev default in `.env`) prints the full firehose: every
HTTP/WS request, every device command + response, and every wire-level message
to/from each device. Set `LOG_LEVEL=info` for a quieter, production-style log.

---

## Option B — Full Docker (production-like)

Everything (server + Postgres + Redis) in containers. The server image runs
migrations on startup, then serves:

```bash
docker compose up -d --build
docker compose logs -f server     # follow logs
```

API is on **http://localhost:3000**. Tear down with `docker compose down`
(`-v` also removes data). The server uses JSON logs and `LOG_LEVEL=info` here.

To load the sample data once:

```bash
docker compose run --rm server bun src/db/seed.ts
```

---

## Option C — In-container dev (hot reload in Docker)

Like B, but the server runs the `dev` target with your source bind-mounted and
`bun --watch` reloading on change:

```bash
docker compose run --rm server bun src/db/migrate.ts          # once
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## Verify it's working

```bash
curl localhost:3000/health                  # {"status":"ok"}
curl localhost:3000/api/v1/drivers           # ["pjlink","tcp-generic"] manifests
curl localhost:3000/api/v1/system/status     # uptime, driver/connection counts
curl localhost:3000/api/v1/connections       # seeded connections + live `running`
```

### Control a device end to end

The seeded connections point at placeholder IPs. To drive something real (or a
mock), create a connection + device and send a command — no UI needed:

```bash
# 1) Add a PJLink projector connection (replace host/port with your device)
CONN=$(curl -s -XPOST localhost:3000/api/v1/connections \
  -H 'content-type: application/json' \
  -d '{"name":"Projector","driverId":"pjlink","host":"192.168.1.50","port":4352}' \
  | bun -e 'console.log((await Bun.stdin.json()).id)')

# 2) Add the projector endpoint
DEV=$(curl -s -XPOST localhost:3000/api/v1/devices \
  -H 'content-type: application/json' \
  -d "{\"connectionId\":\"$CONN\",\"name\":\"Hall projector\",\"type\":\"video\",\"subtype\":\"pjlink.projector\",\"address\":{}}" \
  | bun -e 'console.log((await Bun.stdin.json()).id)')

# 3) Power it on, then read live state
curl -s -XPOST localhost:3000/api/v1/devices/$DEV/command \
  -H 'content-type: application/json' -d '{"command":"on"}'
curl -s localhost:3000/api/v1/devices/$DEV/state
```

Creating the connection starts a driver subprocess immediately; deleting it
(`DELETE /api/v1/connections/$CONN`) stops it.

### WebSocket (real-time)

Connect to `ws://localhost:3000/ws`. You receive a `hello`, then broadcasts like
`{"event":"device:state","data":{...}}`. Send commands too:

```json
{ "event": "device:command", "data": { "deviceId": "...", "command": "on" } }
```

Quick check with [`websocat`](https://github.com/vi/websocat):
`websocat ws://localhost:3000/ws`.

---

## Ports

| Port | Service |
|------|---------|
| 3000 | HTTP API + WebSocket |
| 5432 | Postgres / TimescaleDB |
| 6379 | Redis |

(OSC `8765/udp` and TCP-input `8766` arrive with the protocol-input feature.)

---

## Useful commands

```bash
bun test                                            # hermetic test suite
GALLERY_INTEGRATION=1 bun test apps/server/test/integration  # live (needs infra)
bun run typecheck                                   # tsc --noEmit
bun run --cwd apps/server migrate                   # apply migrations + TimescaleDB
bun run --cwd apps/server seed                      # insert sample data
bun run --cwd apps/server db:generate               # regenerate migration after schema edits
```

---

## Troubleshooting

- **`address already in use :3000`** — a previous server is still running:
  `lsof -ti tcp:3000 | xargs kill -9`.
- **`Cannot connect to the Docker daemon`** — start Docker Desktop (or
  `colima start`), then retry.
- **DB/Redis connection errors** — ensure infra is up and healthy:
  `docker compose ps`. Connection strings live in `.env`
  (`DATABASE_URL`, `REDIS_URL`).
- **Too much / too little logging** — tune `LOG_LEVEL` in `.env`
  (`debug` | `info` | `warn` | `error`).
