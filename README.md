# GalleryOS — Specifikace systému pro ovládání multimediální galerie

**Verze:** 1.0  
**Stav:** Draft — určeno pro implementaci pomocí Claude Code  
**Charakter systému:** Kombinace Home Assistant, Crestron a Bitfocus Companion. Lokální server, bez externích cloudových závislostí.

-----

## Obsah

1. [Přehled a cíle](#1-přehled-a-cíle)
1. [Technologický stack](#2-technologický-stack)
1. [Struktura monorepa](#3-struktura-monorepa)
1. [Systémová architektura](#4-systémová-architektura)
1. [Datový model — PostgreSQL schéma](#5-datový-model--postgresql-schéma)
1. [Driver systém](#6-driver-systém)
1. [Core moduly serveru](#7-core-moduly-serveru)
1. [REST API specifikace](#8-rest-api-specifikace)
1. [WebSocket události](#9-websocket-události)
1. [Admin UI](#10-admin-ui)
1. [User UI](#11-user-ui)
1. [Use cases](#12-use-cases)
1. [Event flows — detailní průtoky](#13-event-flows--detailní-průtoky)
1. [Jak napsat nový driver](#14-jak-napsat-nový-driver)
1. [Deployment — Docker Compose](#15-deployment--docker-compose)
1. [Proměnné prostředí a konfigurace](#16-proměnné-prostředí-a-konfigurace)
1. [Budoucí rozšíření](#17-budoucí-rozšíření)

-----

## 1. Přehled a cíle

### Co systém dělá

GalleryOS je lokální řídicí systém pro multimediální galerii. Umožňuje ovládání libovolných AV zařízení (osvětlení, zvuk, projekce, displeje, závěsy, matice, software jako Pixera nebo vMix) prostřednictvím webového rozhraní, HTTP API, OSC zpráv nebo CRON harmonogramu. Klíčovým konceptem jsou **scény** — pojmenované sekvence akcí, které lze spustit jedním kliknutím nebo příkazem.

### Klíčové vlastnosti

- **Modulární driver systém** — každý výrobce/produkt je samostatný npm balíček s jednotným rozhraním. Přidání nového zařízení = nový driver, bez zásahu do core kódu.
- **Connection + Endpoint model** — gateway zařízení (BSS SoundWeb, DALI gateway, Extron matice) sdílí jeden TCP socket; každý adresovatelný kanál je samostatný logický endpoint viditelný v UI.
- **Scény s paralelním i sériovým prováděním** — akce se skupinují, každá skupina běží paralelně, skupiny postupně.
- **Real-time stav** — WebSocket broadcast do všech připojených klientů po každé změně.
- **Robustní logování** — každá akce, chyba, změna stavu, příchozí OSC/TCP signál je zaznamenaná strukturovaně.
- **Watchdog** — přípojení každé Connection se pravidelně kontroluje; výpadek propaguje na všechny endpointy.
- **CRON plánovač** — harmonogramy uložené v DB, konfigurovatelné za běhu bez restartu.
- **HTTP API** — vše dostupné i pro třetí strany.
- **Připraveno na MCP server** — architektura umožňuje přidat LLM vrstvu pro ovládání přirozenou řečí.
- **Připraveno na autentizaci** — schema a architektura umožní přidat auth bez refaktoru.

### Co systém není

Není cloud-based. Není bezpečnostní systém. Neřeší multi-tenant. Neprovádí real-time media processing. Není monitoring systém pro fyzickou bezpečnost prostoru.

-----

## 2. Technologický stack

### Backend

|Technologie                    |Verze |Důvod                                                                                                |
|-------------------------------|------|-----------------------------------------------------------------------------------------------------|
|**Bun**                        |newest|Event-driven architektura, Integrovaný systém, Nativní podpora TS                                       |
|**TypeScript**                 |5.x   |Typová bezpečnost, IDE podpora, srozumitelnost kódu                                                  |
|**Socket.io**                  |4.x   |Real-time WebSocket s fallbackem, rooms pro broadcast skupinám klientů, Bun                               |
|**Bun Cron**                   |3.x   |CRON plánovač, dynamicky konfigurovatelný za běhu, nativně v Bun                                                    |
|**EventEmitter**               |—     |Interní Event Bus — synchronní, bez externích závislostí pro základní verzi. Bun nebo node:event                         |
|**Ajv**                        |8.x   |JSON Schema validace params driverů a API vstupů                                                     |
|**Winston**                    |3.x   |Strukturované logování, transport do souboru + TimescaleDB (async insert)                            |

### Databáze

|Technologie                                |Použití                                                                                                                                                                                                     |
|-------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**TimescaleDB 2** (PostgreSQL 16 extension)|Hlavní databáze — scény, zařízení, harmonogramy, konfigurace + time-series logování. Tabulka `logs` je TimescaleDB hypertable s automatickou kompresí a retention policy. Žádná extra DB, žádné extra hesla.|
|**Redis 7**                                |Live stav zařízení, pub-sub, session cache, distribuovaný lock                                                                                                                                              |

### ORM / DB přístup

**Drizzle ORM** — typově bezpečné SQL dotazy, migrace, generuje typy přímo ze schématu. Alternativa: `pg` + raw SQL pro jednoduchost. **Doporučuji Drizzle** pro typovou bezpečnost bez overhead Prismy.

### Frontend

|Technologie           |Verze|Důvod                                                                                                                                                                                                                                                                 |
|----------------------|-----|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|**Vue 3**             |3.x  |Composition API, reaktivita, skvělý DX                                                                                                                                                                                                                                |
|**Vite**              |5.x  |Rychlý dev server, optimalizovaný build                                                                                                                                                                                                                               |
|**Pinia**             |2.x  |State management pro Vue 3                                                                                                                                                                                                                                            |
|**Vue Router**        |4.x  |SPA routing                                                                                                                                                                                                                                                           |
|**TailwindCSS**       |3.x  |Utility-first CSS, konzistentní design bez vlastního CSS frameworku                                                                                                                                                                                                   |
|**shadcn-vue**        |—    |Hotové přístupné komponenty postavené na Radix Vue — Dialog, Select, Slider, Switch, Toast, Command, Table, Tabs, Popover, Tooltip, Badge, … Komponenty se kopírují přímo do projektu (`packages/ui/src/components/ui/`), jsou plně přizpůsobitelné a bez skryté magie|
|**Radix Vue**         |—    |Headless primitiva pro přístupnost (instalována automaticky jako závislost shadcn-vue)                                                                                                                                                                                |
|**vue-draggable-plus**|—    |Drag & drop pro scene editor (řazení akcí do skupin) a layout builder (řazení widgetů) — tenký wrapper nad SortableJS, minimální API                                                                                                                                  |
|**motion-v**          |—    |Animace — Vue 3 port Motion One (Framer Motion), čisté `animate()` a direktivy bez boilerplate                                                                                                                                                                        |
|**Socket.io-client**  |4.x  |WebSocket klient                                                                                                                                                                                                                                                      |

### Infrastruktura

|Technologie                |Použití                               |
|---------------------------|--------------------------------------|
|**Docker + Docker Compose**|Kontejnerizace všech služeb           |
|**bun**                    |Package manager (workspace podpora)   |
|**Turborepo**              |Monorepo build systém, sdílené balíčky. Pouze pokud bun nezvládne|

-----

## 3. Struktura monorepa

```
gallery-control/
├── package.json                    # root — pnpm workspaces
├── turbo.json                      # Turborepo pipeline
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
│
├── apps/
│   ├── server/                     # Backend — Bun
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point
│   │   │   ├── config.ts           # Env konfigurace
│   │   │   ├── db/                 # Drizzle schéma + migrace
│   │   │   │   ├── schema.ts
│   │   │   │   ├── migrate.ts
│   │   │   │   └── migrations/
│   │   │   ├── core/
│   │   │   │   ├── EventBus.ts
│   │   │   │   ├── DeviceManager.ts
│   │   │   │   ├── SceneEngine.ts
│   │   │   │   ├── Scheduler.ts
│   │   │   │   ├── Watchdog.ts
│   │   │   │   └── DriverRegistry.ts
│   │   │   ├── drivers/            # DriverHost (subprocess management)
│   │   │   │   └── DriverHost.ts
│   │   │   ├── input/              # Vstupní protokoly
│   │   │   │   ├── OscServer.ts
│   │   │   │   └── TcpInputServer.ts
│   │   │   ├── api/                # REST routes
│   │   │   │   ├── rooms.ts
│   │   │   │   ├── connections.ts
│   │   │   │   ├── devices.ts
│   │   │   │   ├── scenes.ts
│   │   │   │   ├── schedules.ts
│   │   │   │   ├── mappings.ts
│   │   │   │   └── logs.ts
│   │   │   ├── ws/                 # WebSocket handlers
│   │   │   │   └── handlers.ts
│   │   │   └── logger.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── ui/                         # Vue 3 — Admin + User panel (single app)
│       ├── src/
│       │   ├── main.ts
│       │   ├── router/             # /admin/** → AdminLayout, /app/** → UserLayout
│       │   ├── stores/             # Pinia stores (sdílené oběma sekcemi)
│       │   ├── layouts/            # AdminLayout.vue, UserLayout.vue
│       │   ├── views/
│       │   │   ├── admin/          # Stránky admin portálu
│       │   │   └── user/           # Stránky user panelu
│       │   └── components/         # Sdílené komponenty
│       ├── Dockerfile
│       └── package.json
│
└── packages/
    ├── types/                      # Sdílené TypeScript typy
    │   └── src/index.ts
    ├── ui/                         # Sdílené Vue komponenty
    │   └── src/
    ├── driver-core/                # IDeviceDriver interface + typy
    │   └── src/
    │       ├── IDeviceDriver.ts
    │       ├── types.ts
    │       └── index.ts
    └── drivers/
        ├── driver-bss/             # BSS Soundweb London (London DI / TCP)
        ├── driver-dali-lunatone/   # Lunatone DALI-2 IoT (REST/HTTP)
        ├── driver-pjlink/
        ├── driver-extron-matrix/
        ├── driver-samsung-mdc/
        ├── driver-pixera/
        ├── driver-vmix/
        ├── driver-tcp-generic/     # Konfigurovatelný TCP driver pro jednoduché zařízení
        └── driver-template/        # Šablona pro nový driver
```

### `packages/types` — sdílené kontrakty (single source of truth)

Aby **records, messages i logs** zůstaly konzistentní mezi serverem a UI, žije
veškerý sdílený typový kontrakt v jednom workspace balíčku **`@gallery/types`**,
na kterém závisí jak `@gallery/server`, tak `@gallery/ui` (`workspace:*`).
Drizzle schéma je tu jediným zdrojem pravdy pro tvar dat — typy se z něj
**odvozují**, neopisují.

- **`src/schema.ts`** — kompletní Drizzle schéma (přesunuté ze serveru). Server
  ho používá pro dotazy i migrace přes subpath `@gallery/types/schema`;
  `drizzle.config.ts` míří na stejný soubor, takže `drizzle-kit` generuje migrace
  z téhož zdroje.
- **`src/records.ts`** — řádkové typy (`Connection`, `Device`, … = Drizzle
  `$inferSelect`) **plus JSON-wire DTO** (`ConnectionDTO`, `DeviceDTO`, …). DTO
  vznikají přes `Jsonify<T>`, který poctivě mapuje `Date → string` — to je přesný
  tvar, který přejde přes HTTP (server vrací řádky přes `JSON.stringify`).
  `ConnectionWithRuntime = ConnectionDTO & { running }` přidává runtime flag z
  DriverHost poolu. Insert typy (`NewConnection`, …) a request DTO
  (`SceneCreateInput`, …) jsou tu taky.
- **`src/live.ts`** — `DeviceState`, `DeviceStatus`, `ConnectionStatus`
  (Redis live stav; dřív duplikované v BE `DeviceManager` i ve FE).
- **`src/messages.ts`** — WebSocket kontrakt: obálka `WsEnvelope<E, D>` a
  diskriminované uniony `ServerMessage` / `ClientMessage` (+ `ServerEvent`,
  `ServerMessageData<E>`). Server (`api/ws.ts`) i FE stores se proti nim typují,
  takže žádný event ani payload neuteče z kontraktu. Záměrně oddělené od
  interní `GalleryEvent` sběrnice — sdílí se jen to, co reálně přechází po drátě.

**Klíčové rozhodnutí — UI nezatahuje Drizzle do bundlu.** FE importuje výhradně
přes `import type { … } from '@gallery/types'`; `verbatimModuleSyntax` + Vite/
esbuild typové importy úplně smažou, takže runtime Drizzle schéma se do produkčního
buildu nedostane (ověřeno: v `dist` není žádná zmínka o `drizzle`/`pgTable`).
`DeviceManager.ConnectionRecord` / `DeviceRecord` jsou definované jako
`Pick<>` nad schéma-řádky, takže narrow interní view drží krok se schématem.

-----

## 4. Systémová architektura

### Vrstvy systému

```
┌─────────────────────────────────────────────────────┐
│  KLIENTI                                            │
│  UI Vue3 (/admin/** + /app/**)   │  REST API        │
└──────────┬──────────────────────────┬───────────────┘
           │ HTTP / WebSocket          │ HTTP REST
┌──────────▼──────────────────────────▼───────────────┐
│  API VRSTVA                                         │
│  Bun HTTP Server + Socket.io (nebo Bun) WebSocket   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  VSTUPNÍ BUS                                        │
│  TCP Input Server    (časem OSC)                    │
└──────────────────────┬──────────────────────────────┘
                       │ EventBus.emit(...)
┌──────────────────────▼──────────────────────────────┐
│  CORE ENGINE (Internal EventBus)                    │
│                                                     │
│  SceneEngine  │  Scheduler  │  DeviceManager        │
│  Watchdog     │  Logger     │  InputMapper          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  DRIVER VRSTVA                                      │
│  DriverRegistry + DriverHost (subprocess pool)      │
│                                                     │
│  [bss-soundweb] [dali] [pjlink] [extron] [vmix] ... │
└──────────────────────┬──────────────────────────────┘
                       │ TCP/UDP/HTTP
┌──────────────────────▼──────────────────────────────┐
│  FYZICKÁ ZAŘÍZENÍ V GALERII                         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  DATOVÁ VRSTVA                                      │
│  TimescaleDB (PostgreSQL) │ Redis                   │
└─────────────────────────────────────────────────────┘
```

### Klíčové architektonické principy

**1. Internal Event Bus** — všechny moduly komunikují přes události, nikoli přímými voláními. `DeviceManager` neimportuje `SceneEngine`, `SceneEngine` neimportuje `Logger`. Každý modul emituje a naslouchá události. Tím je systém volně provázaný a každý modul lze nahradit nebo testovat izolovaně.

**2. Connection + Endpoint model** — fyzické zařízení (gateway) je `Connection` s jedním TCP socketem. Adresovatelné kanály jsou `Devices` (endpointy). Jeden BSS SoundWeb processor = 1 Connection, 20 mikrofonů a faderů = 20 Device záznamů, každý s vlastní HiQnet adresou. Driver udržuje jeden socket a routuje příkazy podle adresy konkrétního endpointu.

**3. Driver jako subprocess** — každý driver běží v samostatném Node.js subprocesu (`child_process.fork`). Core komunikuje s driverem přes IPC message passing. Při pádu driveru se subprocess restartuje bez ovlivnění core procesu nebo ostatních driverů.

**4. Redis jako live state** — PostgreSQL obsahuje konfiguraci a historii. Redis obsahuje živý stav zařízení (online/offline, aktuální hodnoty, latence). Stav v Redisu je vždy přepsatelný a může být kdykoli ztracen — po restartu se obnoví z prvních dotazů na zařízení.

**5. Immutable audit log** — každá akce se zaloguje před provedením i po dokončení. Log se nikdy nemazá (jen archivuje).

-----

## 5. Datový model — PostgreSQL schéma

Celé schéma je definováno v `apps/server/src/db/schema.ts` pomocí Drizzle ORM. Níže je SQL reprezentace pro čitelnost.

### rooms

Místnosti/zóny galerie. Slouží k organizaci zařízení i scén.

```sql
CREATE TABLE rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  icon          VARCHAR(50),                  -- název ikony z Tabler Icons
  color         VARCHAR(7),                   -- hex barva pro UI (#3B82F6)
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### connections

Fyzická připojení k zařízením nebo gateway. Jeden záznam = jeden TCP/UDP socket nebo HTTP endpoint.

```sql
CREATE TABLE connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  driver_id     VARCHAR(100) NOT NULL,         -- 'bss-soundweb', 'dali', 'pjlink', ...
  host          VARCHAR(255),                  -- IP adresa nebo hostname
  port          INTEGER,
  protocol      VARCHAR(20) DEFAULT 'tcp',     -- 'tcp' | 'udp' | 'http' | 'serial'
  config        JSONB NOT NULL DEFAULT '{}',   -- driver-specifická konfigurace (validovaná dle connectionSchema)
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(100) DEFAULT 'admin'   -- připraveno pro auth
);

CREATE INDEX idx_connections_driver ON connections(driver_id);
```

### devices

Logická zařízení viditelná v UI. Každý Device je adresovatelný endpoint — mikrofon, světlo, fader, projektor, …

```sql
CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   UUID NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
  room_id         UUID REFERENCES rooms(id) ON DELETE SET NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  type            VARCHAR(50) NOT NULL,    -- 'lighting' | 'audio' | 'microphone' | 'video' |
                                           -- 'display' | 'matrix' | 'blind' | 'power' | 'custom'
  subtype         VARCHAR(100),            -- driver-specifický typ, např. 'bss.fader', 'dali.fixture'
  address         JSONB NOT NULL,          -- driver-specifická adresa (validovaná dle addressSchema)
  capabilities    JSONB NOT NULL DEFAULT '[]', -- pole příkazů: ["setLevel","setMute","on","off"]
  metadata        JSONB NOT NULL DEFAULT '{}', -- libovolná extra data (popis, sériové číslo, ...)
  icon            VARCHAR(50),
  display_order   INTEGER NOT NULL DEFAULT 0,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(100) DEFAULT 'admin'
);

CREATE INDEX idx_devices_room ON devices(room_id);
CREATE INDEX idx_devices_connection ON devices(connection_id);
CREATE INDEX idx_devices_type ON devices(type);
```

### scenes

Pojmenované sady akcí. Scéna může být globální nebo přiřazená místnosti.

```sql
CREATE TABLE scenes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID REFERENCES rooms(id) ON DELETE SET NULL,  -- NULL = globální scéna
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  icon          VARCHAR(50),
  color         VARCHAR(7),
  is_favorite   BOOLEAN NOT NULL DEFAULT FALSE,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  variables     JSONB NOT NULL DEFAULT '{}',  -- pro parametrizované scény
  version       INTEGER NOT NULL DEFAULT 1,   -- inkrementuje se při každé editaci
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(100) DEFAULT 'admin'
);

CREATE INDEX idx_scenes_room ON scenes(room_id);
CREATE INDEX idx_scenes_favorite ON scenes(is_favorite);
```

### scene_versions

Verzování scén — při každém uložení se stará verze archivuje.

```sql
CREATE TABLE scene_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id    UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  snapshot    JSONB NOT NULL,    -- celý JSON scény včetně akcí
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  VARCHAR(100) DEFAULT 'admin',

  UNIQUE(scene_id, version)
);

CREATE INDEX idx_scene_versions_scene ON scene_versions(scene_id);
```

### scene_actions

Kroky scény. Každý krok cílí **buď** na jedno zařízení (`device_id` + `command`),
**nebo** na jinou scénu (`child_scene_id`) — tzv. *kompozice scén* (viz §7.3).
Sub-scéna se spustí jako krok celá (celý svůj plán). CHECK constraint vynucuje,
že je nastaven právě jeden z cílů.

```sql
CREATE TABLE scene_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id        UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES devices(id) ON DELETE RESTRICT,
  -- Cíl akce typu zařízení (NULL u sub-scén).
  child_scene_id  UUID REFERENCES scenes(id) ON DELETE RESTRICT,
  -- Cíl akce typu sub-scéna: spustí danou scénu jako krok (NULL u akcí zařízení).
  -- RESTRICT brání smazat scénu, na kterou se odkazuje jiná scéna.
  step_order      INTEGER NOT NULL DEFAULT 0,
  parallel_group  INTEGER NOT NULL DEFAULT 0,
  -- Akce se stejným parallel_group spustí paralelně.
  -- Skupiny se spouštějí sériově vzestupně (0, poté 1, poté 2, ...).
  delay_ms        INTEGER NOT NULL DEFAULT 0,
  -- Pauza před spuštěním *uvnitř* skupiny (pro choreografii).
  command         VARCHAR(100),
  -- Příkaz pro zařízení (NULL u sub-scén).
  params          JSONB NOT NULL DEFAULT '{}',
  on_failure      VARCHAR(20) NOT NULL DEFAULT 'continue',
  -- 'abort' | 'continue' | 'rollback'
  -- Rollback je aplikován pouze na 'reversible' příkazy.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT scene_actions_target_chk CHECK (
    (device_id IS NOT NULL AND child_scene_id IS NULL AND command IS NOT NULL)
    OR (child_scene_id IS NOT NULL AND device_id IS NULL)
  )
);

CREATE INDEX idx_scene_actions_scene ON scene_actions(scene_id, step_order);
CREATE INDEX idx_scene_actions_child ON scene_actions(child_scene_id);
```

### scene_executions

Tracking běžících a dokončených spuštění scény. Kritické pro recovery po výpadku.

```sql
CREATE TABLE scene_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id      UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  status        VARCHAR(20) NOT NULL DEFAULT 'running',
  -- 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted'
  source        VARCHAR(100) NOT NULL,
  -- 'userui' | 'adminui' | 'api' | 'scheduler' | 'osc' | 'tcp'
  source_detail VARCHAR(255),               -- např. 'osc:/scene/execute', 'scheduler:job-uuid'
  pre_state     JSONB,                      -- stav dotčených zařízení před spuštěním (pro rollback)
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  duration_ms   INTEGER
);

CREATE INDEX idx_scene_executions_scene ON scene_executions(scene_id);
CREATE INDEX idx_scene_executions_status ON scene_executions(status);
CREATE INDEX idx_scene_executions_started ON scene_executions(started_at DESC);
```

### scheduled_jobs

CRON harmonogramy.

```sql
CREATE TABLE scheduled_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  scene_id      UUID NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  cron          VARCHAR(100) NOT NULL,     -- CRON výraz, např. '0 8 * * 1-5'
  timezone      VARCHAR(50) NOT NULL DEFAULT 'Europe/Prague',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    VARCHAR(100) DEFAULT 'admin'
);
```

### input_mappings

Mapování příchozích OSC/TCP signálů na akce.

```sql
CREATE TABLE input_mappings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  protocol      VARCHAR(20) NOT NULL,       -- 'osc' | 'tcp' | 'http'
  pattern       VARCHAR(255) NOT NULL,      -- OSC adresa nebo TCP prefix; může obsahovat :param
  target_type   VARCHAR(50) NOT NULL,       -- 'scene.execute' | 'device.command' | 'event.emit'
  target_id     UUID,                       -- FK na scene nebo device podle target_type
  target_command VARCHAR(100),              -- příkaz pro device.command
  params_template JSONB NOT NULL DEFAULT '{}',
  -- Šablona pro mapování vstupních argumentů na akční parametry.
  -- Klíče jsou názvy params, hodnoty jsou buď literály nebo reference na args:
  -- { "level": "{arg[0]}", "muted": false }
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_input_mappings_protocol ON input_mappings(protocol, enabled);
```

### ui_layouts

Konfigurace User UI layoutů.

```sql
CREATE TABLE ui_layouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  config      JSONB NOT NULL DEFAULT '{}',
  -- Struktura config:
  -- {
  --   "pages": [
  --     {
  --       "id": "uuid",
  --       "name": "Sál A",
  --       "icon": "building",
  --       "widgets": [
  --         { "type": "scene_button", "scene_id": "uuid", "size": "large" },
  --         { "type": "device_slider", "device_id": "uuid" },
  --         { "type": "room_header", "room_id": "uuid" },
  --         { "type": "favorites_row" }
  --       ]
  --     }
  --   ]
  -- }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### logs

Strukturovaný audit log jako **TimescaleDB hypertable** — automaticky particionovaná dle `ts`, komprimovaná po 7 dnech, s retention policy pro čištění starých záznamů. Dotazy přes standard SQL bez speciálního query language.

```sql
CREATE TABLE logs (
  id          BIGSERIAL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level       VARCHAR(10) NOT NULL,          -- 'debug' | 'info' | 'warn' | 'error'
  source      VARCHAR(100) NOT NULL,
  -- 'scene_engine' | 'device_manager' | 'driver:{id}' | 'watchdog' |
  -- 'scheduler' | 'api' | 'osc_input' | 'tcp_input'
  entity_type VARCHAR(50),                   -- 'scene' | 'device' | 'connection' | 'job'
  entity_id   UUID,
  message     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  duration_ms INTEGER
);

-- Konverze na TimescaleDB hypertable (particionováno po 1 dni)
SELECT create_hypertable('logs', 'ts', chunk_time_interval => INTERVAL '1 day');

-- Automatická komprese chunků starších 7 dní
ALTER TABLE logs SET (
  timescaledb.compress,
  timescaledb.compress_orderby = 'ts DESC',
  timescaledb.compress_segmentby = 'source, level'
);
SELECT add_compression_policy('logs', INTERVAL '7 days');

-- Retention — smaž chunky starší LOG_RETENTION_DAYS (default 90 dní)
SELECT add_retention_policy('logs', INTERVAL '90 days');

-- Indexy (TimescaleDB automaticky indexuje ts, ostatní přidáme)
CREATE INDEX idx_logs_entity ON logs(entity_type, entity_id, ts DESC);
CREATE INDEX idx_logs_source  ON logs(source, ts DESC);
```

### Redis klíče (dokumentace)

Redis se nepoužívá pro persistenci — jen pro rychlý live přístup.

```
device:{uuid}:status      → { online: bool, latencyMs: number, lastSeen: ISO, lastError: string }
device:{uuid}:state       → { ...driver-specifické hodnoty, např. level: 0.7, muted: false }
connection:{uuid}:status  → { online: bool, latencyMs: number, lastSeen: ISO }
scene:{uuid}:active       → "1" nebo neexistuje — je scéna aktivní?
system:stats              → { connectedClients: number, runningScenes: number }
```

-----

## 6. Driver systém

### Princip

Každý driver je npm balíček ve `packages/drivers/`. Implementuje rozhraní `IDeviceDriver` a exportuje:

1. `manifest` — statický popis driveru (konstantní, bez instanciace)
1. `default` — třída implementující `IDeviceDriver`

Driver **nikdy** nepřistupuje do databáze, nevolá jiné moduly, neví o scénách. Pouze:

- drží TCP/UDP/HTTP spojení s fyzickým zařízením
- překládá obecné příkazy na protokol zařízení
- emituje události změny stavu

### IDeviceDriver interface

Kompletní definice v `packages/driver-core/src/IDeviceDriver.ts`:

```typescript
import { EventEmitter } from 'events';
import type { JSONSchema7 } from 'json-schema';

// ────────────────────────────────────────────
// Typy pro manifest — statický popis driveru
// ────────────────────────────────────────────

export interface DriverManifest {
  id: string;
  name: string;
  version: string;
  vendor: string;
  description?: string;

  // Schéma konfigurace Connection — co admin vyplní při přidávání gateway
  connectionSchema: JSONSchema7;

  // Typy endpointů, které mohou existovat pod touto Connection
  endpointTypes: EndpointTypeDefinition[];

  capabilities: {
    discovery: boolean;      // umí driver automaticky najít endpointy?
    subscriptions: boolean;  // umí zařízení pushovat změny stavu?
    bidirectional: boolean;  // lze číst stav ze zařízení?
  };
}

export interface EndpointTypeDefinition {
  type: string;              // 'bss.fader' | 'dali.fixture' | 'pjlink.projector' | ...
  name: string;
  description?: string;
  addressSchema: JSONSchema7; // co se vyplní v Device.address
  commands: CommandDefinition[];
  stateSchema: JSONSchema7;   // co driver emituje v state eventu
}

export interface CommandDefinition {
  command: string;
  description: string;
  paramsSchema: JSONSchema7;
  reversible: boolean;       // lze tuto akci vrátit zpět při rollbacku?
  estimatedDurationMs?: number;
}

// ────────────────────────────────────────────
// Runtime typy
// ────────────────────────────────────────────

export interface ConnectionConfig {
  id: string;
  driver: string;
  host: string;
  port: number;
  config: Record<string, unknown>;
}

export interface EndpointDescriptor {
  id: string;          // uuid Device záznamu
  type: string;        // odpovídá EndpointTypeDefinition.type
  address: Record<string, unknown>;
  name: string;
}

export interface CommandResult {
  success: boolean;
  durationMs: number;
  state?: Record<string, unknown>;  // nový stav po příkazu, pokud je znám
  error?: string;
}

export interface HealthStatus {
  online: boolean;
  latencyMs?: number;
  details?: string;
  checkedAt: Date;
}

export interface StateChangeEvent {
  endpointId: string;
  state: Record<string, unknown>;
  source: 'subscription' | 'poll' | 'echo';
  timestamp: Date;
}

export interface DriverError {
  level: 'warning' | 'error' | 'fatal';
  message: string;
  endpointId?: string;
  cause?: unknown;
}

export interface DriverContext {
  logger: DriverLogger;
  storage: DriverKVStore;   // per-driver persistentní KV store (Redis namespace)
  dryRun: boolean;          // pokud true, driver simuluje bez reálných akcí
  signal: AbortSignal;      // zrušen při destroy()
}

export interface DriverLogger {
  debug(msg: string, meta?: object): void;
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
}

export interface DriverKVStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// ────────────────────────────────────────────
// Hlavní interface — implementují drivery
// ────────────────────────────────────────────

export interface IDeviceDriver extends EventEmitter {
  readonly manifest: DriverManifest;

  // Lifecycle
  init(config: ConnectionConfig, ctx: DriverContext): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  destroy(): Promise<void>;

  // Stav
  isConnected(): boolean;
  healthCheck(): Promise<HealthStatus>;
  endpointHealthCheck?(endpoint: EndpointDescriptor): Promise<HealthStatus>;

  // Příkazy
  executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult>;

  readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>>;

  // Volitelné — jen pokud capabilities.subscriptions === true
  subscribeToEndpoint?(endpoint: EndpointDescriptor): Promise<void>;
  unsubscribeFromEndpoint?(endpoint: EndpointDescriptor): Promise<void>;

  // Volitelné — jen pokud capabilities.discovery === true
  discoverEndpoints?(): Promise<EndpointDescriptor[]>;

  // Emitované události (přes EventEmitter)
  // 'connected'      → ()
  // 'disconnected'   → (reason: string)
  // 'state'          → (e: StateChangeEvent)
  // 'error'          → (e: DriverError)
}
```

### DriverHost — správce subprocesů

`apps/server/src/drivers/DriverHost.ts` — spravuje pool subprocesů pro každou Connection.

Odpovědnosti:

- Pro každou aktivní `Connection` v DB spustit subprocess (`fork`)
- Předat mu config přes IPC `init` zprávu
- Přeposílat příkazy od `DeviceManager` do subprocesu přes IPC
- Přeposílat události ze subprocesu (state, error, connected, disconnected) na `EventBus`
- Při pádu subprocesu ho restartovat s exponenciálním backoff (1s → 2s → 4s → max 30s)
- Při deaktivaci Connection subprocess gracefully ukončit

Formát IPC zpráv (obousměrný):

```typescript
// Core → Driver
type CoreToDriverMessage =
  | { type: 'init'; config: ConnectionConfig; context: { dryRun: boolean } }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'destroy' }
  | { type: 'executeCommand'; requestId: string; endpoint: EndpointDescriptor; command: string; params: Record<string, unknown> }
  | { type: 'readState'; requestId: string; endpoint: EndpointDescriptor }
  | { type: 'healthCheck'; requestId: string }
  | { type: 'subscribeToEndpoint'; endpoint: EndpointDescriptor }
  | { type: 'unsubscribeFromEndpoint'; endpoint: EndpointDescriptor }
  | { type: 'discoverEndpoints'; requestId: string };

// Driver → Core
type DriverToCoreMessage =
  | { type: 'ready' }
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'state'; event: StateChangeEvent }
  | { type: 'error'; error: DriverError }
  | { type: 'reply'; requestId: string; result: unknown; error?: string };
```

### DriverRegistry

`apps/server/src/core/DriverRegistry.ts` — čte manifesty všech nainstalovaných driverů bez jejich instanciace.

Manifest každého driveru je staticky exportovaný z balíčku (`packages/drivers/driver-bss/src/manifest.ts`). Registry ho načte při startu serveru, uloží do paměti. Admin UI pak volá `GET /api/v1/drivers` a dostane seznam driverů s jejich manifesty pro generování formulářů.

### Přehled implementovaných driverů

|Driver ID      |Zařízení                              |Protokol    |Subscriptions         |Discovery |
|---------------|--------------------------------------|------------|----------------------|----------|
|`bss-soundweb` |BSS Soundweb London procesory ✓       |TCP/London DI|Ano (SUBSCRIBE)      |Ne        |
|`dali-lunatone`|Lunatone DALI-2 IoT gateway ✓         |HTTP/REST   |Ne                    |Ano (sken)|
|`dali-foxtron` |Foxtron DALInet / DALI2net brána ✓    |TCP/ASCII   |Ne (poll)             |Ne        |
|`netio`        |NETIO chytré zásuvky (PowerBOX/PDU) ✓ |HTTP/JSON   |Ne (poll)             |Ne        |
|`pjlink`       |PJLink projektory                     |TCP         |Ne (poll)             |Ne        |
|`extron-matrix`|Extron video matice                   |TCP/SIS     |Ne                    |Ne        |
|`samsung-mdc`  |Samsung displeje / video wall         |TCP/MDC     |Ne (poll)             |Ne        |
|`vmix`         |vMix video mixer                      |TCP         |Ano (XML subscription)|Ne        |
|`tcp-generic`  |Jednoduchá TCP zařízení (závěsy, relé)|TCP         |Ne                    |Ne        |
|`pixera`       |Pixera media server *(odloženo)*      |TCP/JSON API|Ano                   |Ne        |

#### `driver-bss` — BSS Soundweb London (implementováno)

Balíček `packages/drivers/driver-bss` (driver id `bss-soundweb`). Mluví **London DI
protokolem** přes TCP 1023 — ne HiQnet network model, jak původně odhadoval PLAN.
Protokol je odvozen z přiloženého manuálu (`manuals/Soundweb-London-Third-Party-Control.pdf`)
a ověřeného skriptu `manuals/bss.js`.

- **`src/london-di.ts`** — čistý, samostatně testovaný kodek. Rámec
  `STX(0x02) │ substitute( body │ checksum ) │ ETX(0x03)`; `body = typ(1) │ node(2) │
  virtualDevice(1) │ object(3) │ param(2) │ value(4)`; checksum = XOR `body` **před**
  byte-substitucí; 5 rezervovaných bytů se escapuje (`0x02 0x03 0x06 0x15 0x1B → 0x1B 0x8x`).
  Hodnoty jsou 32-bit signed BE; percent-raw = `percent × 65536`. Obsahuje `FrameDecoder`
  pro streamované dekódování (rozdělené i slepené rámce). Unit test ověřuje shodu
  s přesným výstupem `bss.js`.
- **`src/BssSoundwebDriver.ts`** — jeden perzistentní socket na connection sdílený všemi
  fadery. Na `connect()` (a po reconnectu s exponenciálním backoffem) se **re-subscribuje**
  každý sledovaný endpoint. Příchozí SET / SET PERCENT pushe se routují přes mapu
  `node:vd:object:param → {endpointId, field}` a emitují jako `state` událost.
  - **Žádný GET** — `readState` použije SUBSCRIBE (zařízení okamžitě pošle aktuální hodnotu).
  - **Žádný app-level keepalive** — manuál říká nechat TCP socket trvale otevřený.
  - `setLevel (0..1)` → SET PERCENT (0x8D), `setMute (bool)` → SET (0x88).
- **Endpoint `bss-soundweb.fader`**, adresa `{ node, object, virtualDevice?=3, gainParam?=0,
  muteParam?=1 }` — fader potřebuje dva parametry (gain + mute), proto adresa nese oba.

#### `driver-dali-foxtron` — Foxtron DALInet / DALI2net (implementováno)

Balíček `packages/drivers/driver-dali-foxtron` (driver id `dali-foxtron`). Ovládá
DALI svítidla přes bránu Foxtron přes její **ASCII protokol nad TCP** (manuál
`manuals/DALI232-komunikacni-protokol.pdf`, ověřeno proti funkčnímu skriptu zákazníka).

- **`src/foxtron-codec.ts`** — čistý, samostatně testovaný kodek. Rámec
  `SOH(0x01) │ hex( data │ checksum ) │ ETB(0x17)`; každý byte se posílá jako dva
  ASCII hex znaky; checksum = `(~Σ data) & 0xFF`. Unit test ověřuje shodu s
  příkladem z manuálu (`01 00 10 FF 10 → 0xDF`). Obsahuje `FrameDecoder` a DALI
  adresovací pomocníky (DAPC `addr*2`, příkaz `addr*2+1`, broadcast `0xFE/0xFF`).
- **`src/DaliFoxtronDriver.ts`** — ⚠️ **transport: krátkožijící TCP spojení na každý
  příkaz** (connect → send → close). Brána totiž zavírá nečinná spojení po ~1–2 s,
  takže perzistentní socket vede k nekonečnému reconnect loopu. Operace jsou
  serializovány (jedno spojení v jeden čas).
  - `on` → Recall Max Level, `off` → Off, `setBrightness` → DAPC (0–254), `recall` → scéna 0–15 (Type 1, fire-and-forget).
  - `readState` → DALI Query Actual Level přes **Type 11** (odpověď přijde jako
    Type 13/14 přiřazená nám, ne Type 3/4 = aktivita jiných masterů na sběrnici).
  - `healthCheck` → Type 6 dotaz na stav napájení DALI sběrnice (položka 3).
- **Endpoint `dali-foxtron.fixture`** podporuje tři režimy adresování (`addressMode`):
  - `"address"` → jedno svítidlo: `{ daliAddress: 0..63 }` (DAPC `addr*2`, příkaz `addr*2+1`)
  - `"group"` → DALI skupina: `{ group: 0..15 }` (DAPC `g*2+0x80`, příkaz `g*2+0x81`)
  - `"broadcast"` → všechna svítidla najednou (`0xFE` / `0xFF`)
  - Když `addressMode` chybí, odvodí se z přítomnosti `daliAddress`/`group` (zpětná kompatibilita).
  - `readState` přes skupinu/broadcast vrací poslední optimistický stav (více svítidel
    nelze spolehlivě dotázat — odpovědi kolidují); jen individuální adresa dělá reálný dotaz.
- Pro DALI2net použij port 23 (sběrnice 1) nebo 24 (sběrnice 2) jako dvě samostatné connections.

#### `driver-netio` — NETIO chytré zásuvky (implementováno)

Balíček `packages/drivers/driver-netio` (driver id `netio`). Ovládá NETIO síťové
zásuvky (PowerBOX, PowerPDU, PowerDIN) přes **JSON M2M API nad HTTP** (manuál
`manuals/NETIO-M2M-API-Protocol-JSON.pdf`).

- **`src/NetioDriver.ts`** — `GET /netio.json` pro čtení stavu všech výstupů,
  `POST /netio.json` pro ovládání; HTTP Basic auth (`username`/`password` z configu).
  Metering pole (`load`/`current`/`energy`) se přidají do stavu jen u modelů, které je vrací.
- **Endpoint `netio.socket`**, adresa `{ outputId: 1..8 }`. Příkazy: `on`, `off`,
  `toggle`, `shortOn`/`shortOff` (s volitelným `delayMs` — krátký impuls / power-cycle,
  Action 1/0/4/3/2 dle protokolu).

-----

## 7. Core moduly serveru

### 7.1 EventBus

`apps/server/src/core/EventBus.ts`

Centrální synchronní EventEmitter. Všechny moduly ho importují. Je to singleton.

Definované typy událostí:

```typescript
export type GalleryEvent =
  // Zařízení
  | { type: 'device.state.changed';   deviceId: string; state: Record<string, unknown>; source: string }
  | { type: 'device.online';          deviceId: string; connectionId: string }
  | { type: 'device.offline';         deviceId: string; connectionId: string; reason: string }
  // Connection
  | { type: 'connection.connected';   connectionId: string }
  | { type: 'connection.disconnected';connectionId: string; reason: string }
  | { type: 'connection.error';       connectionId: string; error: string }
  // Scény
  | { type: 'scene.execute.requested'; sceneId: string; source: string; executionId: string }
  | { type: 'scene.execute.started';   sceneId: string; executionId: string }
  | { type: 'scene.execute.completed'; sceneId: string; executionId: string; durationMs: number }
  | { type: 'scene.execute.failed';    sceneId: string; executionId: string; error: string }
  | { type: 'scene.execute.aborted';   sceneId: string; executionId: string }
  // Vstupní signály
  | { type: 'input.osc.received';     address: string; args: unknown[] }
  | { type: 'input.tcp.received';     message: string; client: string }
  // Systém
  | { type: 'system.driver.crashed';  connectionId: string; driverId: string; error: string }
  | { type: 'system.startup.complete' };
```

### 7.2 DeviceManager

`apps/server/src/core/DeviceManager.ts`

Orchestruje veškerou komunikaci s fyzickými zařízeními. Je jediný, kdo volá `DriverHost`.

Odpovědnosti:

1. Při startu načíst všechny aktivní `Connection` záznamy z DB a inicializovat `DriverHost` pro každou.
1. Udržovat v paměti mapu `connectionId → DriverHostInstance`.
1. Pro každý příkaz `execute(deviceId, command, params)`:
   a. Načíst `Device` (z cache nebo DB)
   b. Zjistit jeho `connection_id` a endpoint descriptor
   c. Zavolat `DriverHost.executeCommand(connectionId, endpoint, command, params)`
   d. Výsledek zalogovat na `EventBus`
1. Naslouchat `state` události z `DriverHost` a:
   a. Uložit nový stav do Redisu (`device:{id}:state`)
   b. Emitovat `device.state.changed` na `EventBus`
1. Poskytovat `readState(deviceId)` — nejprve zkusí Redis cache, pak dotaz na driver.

Funkce `execute` je thread-safe z pohledu jednoho endpointu — používá `AsyncMutex` per endpoint pro zamezení race condition při souběžných příkazech na stejné zařízení.

### 7.3 SceneEngine

`apps/server/src/core/SceneEngine.ts`

Vykonává scény. Nejkomplexnější modul systému.

Spuštění scény (`executeScene(sceneId, source)`):

**Zjednodušení oproti původnímu návrhu:** bez verzování scén, bez rollbacku, bez recovery po pádu serveru. Systém je nekritický.

1. **Validace a pre-flight:**
- Načíst scénu + akce z DB
- Zkontrolovat, zda scéna není už spuštěna (Redis `scene:{id}:active` key) — pokud ano, vrátit 409
- Ověřit, že všechna dotčená zařízení existují (online check je informativní, nikoli blokující)
1. **Zápis do DB:**
- Vytvořit `SceneExecution` záznam se statusem `running`
- Emitovat `scene.execute.started` na `EventBus`
- Nastavit Redis `scene:{id}:active = “1”`
1. **Execution plán:**
- Skupinovat akce podle `parallel_group` (stejná čísla = skupina)
- Třídit skupiny vzestupně
- Pro každou skupinu: spustit všechny akce v ní paralelně (`Promise.all`)
- Pokud skupina selže a `on_failure = abort`: okamžitě přerušit
- `on_failure = continue`: logovat chybu a pokračovat dál
- Respektovat `delay_ms` uvnitř skupiny (každá akce před spuštěním počká svůj delay)
1. **Vykonání jedné akce:**
   
   ```
   DeviceManager.execute(action.device_id, action.command, action.params)
   → logovat výsledek
   → emitovat device.state.changed
   ```
1. **Dokončení:**
- Aktualizovat `SceneExecution` na `completed` / `failed` / `aborted`
- Emitovat `scene.execute.completed` nebo `scene.execute.failed`
- Smazat Redis `scene:{id}:active`

**Parallel group příklad:**

```
Scéna "Přednáška sál A":
  group 0: [zatáhni závěsy, ztlum světla na 30%]         ← paralelně
  group 1: [zapni projektor]                              ← čeká na group 0
  group 2: [přepni vstup projektoru na HDMI1, odmutuj mic] ← čeká na group 1
```

**Implementováno (Priorita 2)** — `apps/server/src/core/SceneEngine.ts`:

- **Dependency injection:** engine dostává úzká rozhraní (`scenes`, `executions`,
  `state`, `deviceManager`, `devices`, `eventBus`, `logger`), takže je plně
  testovatelný s in-memory fakes (bez DB / Redis / subprocess).
- **Dva vstupní body:** `executeScene(...)` doběhne do konce a vrátí výsledek
  (scheduler, testy); `startScene(...)` provede pre-flight synchronně (kvůli
  409/404/400), spustí plán na pozadí a hned vrátí `{ executionId, status: "running" }`
  (REST). `start()` navíc naslouchá `scene.execute.requested` (trigger z WebSocketu).
- **Typed chyby:** `SceneNotFoundError` → 404, `SceneConflictError` → 409,
  `SceneValidationError` → 400. Vyhozeny v pre-flightu před jakýmkoli side-effectem.
- **`planGroups()`** je čistá funkce (grupování dle `parallel_group`, vzestupně).
- **Dry-run (`dryRun(sceneId)`):** ⚠️ oprava návrhu — `dryRun` se **nepropaguje** do
  DeviceManageru per-příkaz (driver subprocess má `dryRun` fixní z `init`, a živé
  connectiony běží naostro). Engine proto v dry-runu hardware vůbec nevolá: jen
  zvaliduje scénu + zařízení a vrátí naplánované akce (žádný zámek, žádný DB zápis,
  žádné EventBus události).
- **Redis zámek:** `redisSceneStore` (`scene:{id}:active`) v `src/redis/state.ts`.
- **REST** `src/api/routes/scenes.ts` a **WS** `scene:execute` handler v `src/api/ws.ts`
  (validuje scénu → emituje `scene.execute.requested` → ack `{ executionId }`).
- **Kompozice scén (sub-scény):** akce může místo zařízení cílit na jinou scénu
  (`child_scene_id`) — viz níže.
- **Testy:** 20 hermetických testů enginu (grupování, on_failure abort/continue,
  konflikt/404/validace, dry-run, background `startScene`, event trigger,
  kompozice scén), 12 testů REST routes (incl. mapování chyb), 2 WS testy +
  rozšířený DB integration test.

#### Kompozice scén (sub-scény)

Akce scény může cílit **buď** na zařízení (`device_id` + `command`), **nebo** na
jinou scénu (`child_scene_id`). Scénu "Vypni vše" tak lze složit ze scén
"Vypni sál A", "Vypni sál B" a "Vypni Foyer". Protože parent drží jen **odkaz**
na child scénu, úprava child scény se automaticky promítne do všech parentů, které
ji používají — žádná duplikace akcí.

- **Provedení:** narazí-li engine na akci se `childSceneId`, spustí celou child
  scénu jako vnořený běh na pozici té akce — s **vlastním** execution rowem,
  zámkem a událostmi (`scene.execute.started/completed/failed`). Child běží do
  konce, pak se pokračuje další skupinou parentu.
- **Hodnocení úspěchu:** sub-scéna se počítá jako *neúspěšná akce* (a aktivuje
  `on_failure` rodičovské akce), když je její celkový status `failed` (akce s
  `abort` nebo chyba enginu), nebo když je vnořený běh odmítnut v pre-flightu
  (např. child už běží → `SceneConflictError`). Selhání úrovně `continue`
  *uvnitř* child scény parenta neshodí — stejně jako u akce zařízení se hodnotí
  jen její vlastní výsledek.
- **Pre-flight rozbalí celý strom:** ověří existenci všech zařízení i sub-scén a
  **odmítne cykly** (`SceneValidationError`). `MAX_SCENE_DEPTH = 16` je pojistka
  proti zacyklení, pokud by detekce cyklů byla obejita.
- **Integrita v DB:** FK `child_scene_id … ON DELETE RESTRICT` brání smazat scénu,
  na kterou se odkazuje jiná scéna; CHECK constraint vynucuje právě jeden cíl akce.

### 7.4 Scheduler

`apps/server/src/core/Scheduler.ts`

Načte všechny aktivní `scheduled_jobs` záznamy z DB při startu a naplánuje je.

**Timezone handling:** cron výraz každého jobu se interpretuje v jeho vlastní IANA
timezone; Scheduler spočítá **absolutní UTC** čas příštího spuštění a naplánuje ho
přes `setTimeout`. Po každém spuštění se příští výskyt přepočítá znovu — tím je
správně ošetřen přechod letního/zimního času (offset se vzorkuje pokaždé čerstvě,
ne jako konstanta). Úložiště i výpočty jsou v UTC; převod do lokálního času je
záležitost zobrazovací logiky.

> ⚠️ **Oprava návrhu:** PLAN §3 předpokládal `Temporal.ZonedDateTime` „vestavěné
> v Bun", to ale v runtime **není** (Bun 1.3.x, žádný Temporal global). Převody
> wall-clock ↔ UTC jsou proto implementovány přes `Intl.DateTimeFormat` (vždy
> dostupné, plně DST-aware). Výsledek je stejný: job `0 9 * * *` v `Europe/Prague`
> spustí v zimě v 08:00 UTC a v létě v 07:00 UTC.

**Implementováno (Priorita 3):**

- **`src/core/cron.ts`** — čistý, samostatně testovaný modul. `parseCron` /
  `isValidCron` validují celou 5-položkovou gramatiku (`*`, seznamy, rozsahy,
  kroky `*/15`, Vixie OR-sémantika pro day-of-month + day-of-week).
  `computeNextRuns(cronExpr, timezone, count, from?)` vrací příštích N UTC instantů
  (a `computeNextRun` jeden). Dvouprůchodový převod wall-clock → UTC zvládá DST
  mezery i překryvy.
- **`Scheduler`** — jeden `setTimeout` na job mířící na příští UTC čas. Po
  spuštění: zapíše `last_run_at`, spustí scénu přes
  `SceneEngine.executeScene(sceneId, 'scheduler', { sourceDetail: 'scheduler:{id}' })`
  (neблокuje rescheduling — pomalý/konfliktní běh nezdrží přeplánování) a přepočítá
  + ozbrojí příští výskyt (zapíše `next_run_at`).
- **Dlouhé čekání:** prodlevy přes ~24,8 dne (limit `setTimeout`) se štěpí a
  přehodnocují, takže i vzdálené cron joby (např. roční 29. 2.) spolehlivě spustí.
- **Dynamický reload** — `addJob` / `removeJob` / `reloadJob(id)`; schedules REST
  controller je volá po create/update/toggle/delete, takže změny cronu platí za
  běhu bez restartu serveru.
- **Missed-run při startu:** porovná `next_run_at` s aktuálním časem — vynechaný
  běh **zaloguje varování** (nikdy ho automaticky nedohání — je to galerie, ne
  kritická infrastruktura) a job přeplánuje dál.
- **Testovatelnost:** hodiny (`now`) i časovače (`setTimer`/`clearTimer`) jsou
  injektovatelné, takže `Scheduler` se testuje s virtuálním časem bez reálných
  timerů, DB i SceneEngine.
- **`stop()`** zruší všechny čekající timery (zapojeno do graceful shutdownu).
- Zapojeno do `src/api/context.ts` a `src/index.ts`; REST viz §8 `/schedules`.

### 7.5 Watchdog

`apps/server/src/core/Watchdog.ts`

Dvouvrstvé monitorování připojení.

**Vrstva 1 — Connection health** (každých 10 sekund pro každou Connection):

- Zavolat `DriverHost.healthCheck(connectionId)`
- Výsledek uložit do Redis `connection:{id}:status`
- Pokud se stav změní (online ↔ offline): emitovat `connection.connected` / `connection.disconnected` na `EventBus`
- `DeviceManager` na tyto události naslouchá a updatuje stav všech endpointů dané Connection

**Vrstva 2 — Endpoint health** (každých 60 sekund, postupně — ne vše najednou):

- Pro každý endpoint: zavolat `DriverHost.endpointHealthCheck(connectionId, endpoint)` — pokud driver tuto metodu implementuje
- Uložit výsledek do Redis `device:{id}:status`
- Emitovat `device.online` nebo `device.offline` na EventBus

Interval Watchdog hlídání je konfigurovatelný per Connection v `connections.config.watchdogIntervalMs`.

### 7.6 Logger

`apps/server/src/logger.ts`

Winston logger s transporty:

1. **Console** (dev mode) — čitelný formát
1. **File** — `logs/gallery.log`, rotace po 10MB, max 5 souborů
1. **TimescaleDB** — async insert do hypertable `logs` přes Drizzle; komprese a retention policy řeší databáze sama

Každý modul dostane instanci loggeru s `source` již vyplněným:

```typescript
const log = logger.child({ source: 'scene_engine' });
log.info('Scene started', { sceneId, executionId, source: 'userui' });
```

#### DbLogTransport — `apps/server/src/db/log-transport.ts`

Implementováno (Step 0.2). Vlastní Winston transport (`winston-transport`), který strukturované log záznamy **dávkově** zapisuje do hypertable `logs` přes Drizzle:

- **Batching:** flush proběhne každých `flushIntervalMs` (default 500 ms) **nebo** jakmile se nasbírá `batchSize` záznamů (default 50) — podle toho, co nastane dřív. Tím se zabrání tlaku jednotlivých zápisů při log burstech.
- **Mapování polí:** vyhrazená pole (`level`, `message`, `source`, `entityType`, `entityId`, `durationMs`) jdou do sloupců; veškerá ostatní meta data se složí do `metadata` JSONB.
- **Serializovaný flush chain:** flushe se nikdy nepřekrývají (žádné souběžné DB zápisy), i když batch a interval spadnou současně.
- **Odolnost vůči chybám:** selhání insertu se zaloguje na stderr a dávka se zahodí (žádné retry smyčky) — stejná data drží console + file transport.
- **Lifecycle:** `start()` ozbrojí flush timer, `stop()` zruší timer a vyprázdní zbylé záznamy. Ve `src/index.ts` se přidá přes `winstonRoot.add(...)` a při shutdownu se `stop()` zavolá **před** uzavřením DB spojení, aby se buffer stihl zapsat.

### 7.7 Protocol Input Bus

#### OscServer — `apps/server/src/input/OscServer.ts`

UDP server poslouchající na portu `OSC_PORT` (default 8765).

Pro každou přijatou OSC zprávu:

1. Emitovat `input.osc.received` na EventBus (pro logování)
1. Vyhledat pasující `InputMapping` záznamy z DB cache (pattern matching)
1. Pro každý match: vyhodnotit `params_template` (substituovat `{arg[0]}`, `{arg[1]}`, …)
1. Spustit akci dle `target_type`:
- `scene.execute` → `SceneEngine.executeScene(targetId, 'osc')`
- `device.command` → `DeviceManager.execute(targetId, targetCommand, params)`

Pattern matching: `/scene/execute` matchuje přesně, `/dim/:level` matchuje `/dim/0.5` a extrahuje `level = "0.5"`.

#### TcpInputServer — `apps/server/src/input/TcpInputServer.ts`

Jednoduchý TCP server (default port 8766). Očekává newline-delimited JSON nebo konfigurovatelné string příkazy. Stejná logika jako OSC — vyhledá mapping a spustí akci.

-----

## 8. REST API specifikace

Base URL: `http://server:3000/api/v1`

Všechny endpointy vrací JSON. Chyby mají formát `{ error: string, details?: object }`.

### Rooms

```
GET    /rooms                    - seznam místností
POST   /rooms                    - vytvorit místnost
GET    /rooms/:id                - detail místnosti
PUT    /rooms/:id                - aktualizovat
DELETE /rooms/:id                - smazat (pokud nemá devices nebo scenes)
GET    /rooms/:id/devices        - zařízení v místnosti
GET    /rooms/:id/scenes         - scény přiřazené místnosti
```

### Connections

```
GET    /connections              - seznam spojení
POST   /connections              - přidat connection (spustí DriverHost subprocess)
GET    /connections/:id          - detail
PUT    /connections/:id          - aktualizovat (restart DriverHost)
DELETE /connections/:id          - smazat (disconnect + kill subprocess)
POST   /connections/:id/connect  - ruční reconnect
POST   /connections/:id/disconnect
GET    /connections/:id/status   - live stav z Redis (online, latency)
POST   /connections/:id/discover - spustit discovery endpointů (pokud driver podporuje)
GET    /drivers                  - seznam dostupných driverů s manifesty
GET    /drivers/:id/manifest     - manifest konkrétního driveru
```

### Devices (Endpoints)

```
GET    /devices                  - seznam zařízení (?room_id=, ?type=, ?enabled=)
POST   /devices                  - přidat zařízení
GET    /devices/:id              - detail
PUT    /devices/:id              - aktualizovat
DELETE /devices/:id              - smazat
GET    /devices/:id/status       - live stav (online/offline, latence) z Redis
GET    /devices/:id/state        - aktuální hodnoty (level, muted, ...) z Redis
GET    /devices/live             - dávkový snapshot { [id]: { state, status } }
                                   pro celé UI najednou (jeden request místo 2×N)
POST   /devices/:id/command      - přímý příkaz { command: string, params: object }
                                   (mimo scény, pro testování nebo přímé ovládání)
```

### Scenes

```
GET    /scenes                   - seznam scén (?room_id=, ?is_favorite=, ?tags=)
POST   /scenes                   - vytvorit scénu
GET    /scenes/:id               - detail scény včetně akcí
PUT    /scenes/:id               - aktualizovat scénu (vytvoří novou scene_version)
DELETE /scenes/:id               - smazat scénu
POST   /scenes/:id/execute       - spustit scénu { source?: string } → 202 { executionId, status }
POST   /scenes/:id/execute/dry-run - simulovat bez reálných akcí
GET    /scenes/:id/executions    - historie spuštění
GET    /scenes/:id/versions      - seznam verzí                       (odloženo)
GET    /scenes/:id/versions/:version - konkrétní verze (snapshot)     (odloženo)
POST   /scenes/:id/versions/:version/restore - obnovit starší verzi   (odloženo)
PATCH  /scenes/:id/favorite      - toggle oblíbená { is_favorite: bool }
```

> **Implementováno (Priorita 2):** vše výše kromě `*/versions*` — verzování scén je
> odloženo (tabulka `scene_versions` v schématu zůstává, ale bez logiky). PUT scény
> tedy **nevytváří** novou `scene_version`, jen nahradí metadata + akce. `on_failure`
> podporuje `continue` a `abort` (žádný `rollback`).

### Scheduled Jobs

```
GET    /schedules                - seznam CRON jobů
POST   /schedules                - vytvořit job
GET    /schedules/:id            - detail
PUT    /schedules/:id            - aktualizovat (reload v Scheduleru)
DELETE /schedules/:id            - smazat (odregistrovat z cron)
PATCH  /schedules/:id/toggle     - zapnout/vypnout
GET    /schedules/:id/next       - příštích 5 spuštění (preview)
```

### Input Mappings

```
GET    /mappings                 - seznam mapování
POST   /mappings                 - vytvořit
GET    /mappings/:id             - detail
PUT    /mappings/:id             - aktualizovat
DELETE /mappings/:id             - smazat
POST   /mappings/test            - test pattern matching { protocol, address, args }
```

### UI Layouts

```
GET    /layouts                  - seznam layoutů
POST   /layouts                  - vytvořit layout
GET    /layouts/:id              - detail (full config JSON)
PUT    /layouts/:id              - uložit layout
DELETE /layouts/:id              - smazat
PATCH  /layouts/:id/default      - nastavit jako výchozí
```

### Logs

```
GET    /logs                     - seznam logů (?level=, ?source=, ?entity_id=, ?from=, ?to=, ?limit=, ?offset=)
GET    /logs/stats               - statistiky (počty dle level za posledních 24h, 7d)
GET    /logs/executions          - přehled spuštění scén s výsledky (?scene_id=, ?status=, ?limit=)
```

**Implementováno (Step 0.3)** — `apps/server/src/api/routes/logs.ts`, read-only nad hypertable `logs` (plněnou přes `DbLogTransport`) a tabulkou `scene_executions`:

- `GET /logs` — filtry `level`/`source`/`entity_id` + časové meze `from`/`to` (ISO-8601) + stránkování. `limit` se clampuje na 1–1000 (default 100), výstup řazen `ts DESC`. Neplatný integer nebo datum → `400 BAD_REQUEST`.
- `GET /logs/stats` — `statsByLevel` agregace (`GROUP BY level`) pro dvě okna: posledních 24 h a 7 dní; obě se počítají paralelně (`Promise.all`).
- `GET /logs/executions` — historie spuštění scén s `LEFT JOIN` na `scenes` (kvůli `sceneName`); funguje i bez SceneEngine, protože čte jen tabulku.
- Data se přistupují přes nové repozitáře `logsRepo` a `sceneExecutionsRepo` (`src/db/repositories.ts`), injektované do route přes `ApiContext` — stejný vzor jako rooms/devices, takže route jde testovat s fake repo bez DB.

### Systém

```
GET    /system/status            - zdraví systému (uptime, connected clients, running scenes, ...)
GET    /system/drivers           - přehled stavu všech subprocess driverů
POST   /system/reload-drivers    - znovu načíst všechny drivery (restart subprocess pool)
```

-----

## 9. WebSocket události

Socket.io server na stejném portu jako HTTP. Namespace `/` pro celou UI aplikaci — admin i user sekce sdílí jedno Socket.io připojení, přístup k citlivým událostem se bude řídit rolí (po přidání auth).

### Klient → Server

```typescript
// Spustit scénu
socket.emit('scene:execute', { sceneId: string })
socket.on('scene:execute:ack', (data: { executionId: string } | { error: string }) => {})

// Přímý příkaz na zařízení
socket.emit('device:command', { deviceId: string, command: string, params: object })
// Origin dělá optimistický update a čeká na ack (jen jemu):
socket.on('device:command:ack', (data: {
  deviceId: string;
  success: boolean;          // vždy přítomno (i při výjimce) → UI nechá / vrátí stav
  state?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}) => {})
// Při úspěchu server navíc broadcastne `device:state` ostatním UI (viz níže).
// Při chybě se NEbroadcastuje nic — jen warn log; origin podle `success: false` vrátí stav.
```

### Server → Klient (broadcast všem)

```typescript
// Stav zařízení se změnil
socket.on('device:state', (data: {
  deviceId: string;
  state: Record<string, unknown>;
  source: string;
  timestamp: string;
}) => {})
// Pozn.: `device:state` se broadcastuje deduplikovaně — jedna akce typicky
// vyprodukuje dvě identické změny stavu (optimistický výsledek `command` a
// následný `echo` od driveru). Server porovnává stav s poslední odeslanou
// hodnotou pro dané zařízení a UI dostane změnu jen jednou (bez ohledu na
// `source`). Potlačené echo se stále zaznamenává do server logu. `source`
// zůstává v payloadu pro informaci, ale UI se jím nemusí řídit.

// Online/Offline
socket.on('device:online',  (data: { deviceId: string }) => {})
socket.on('device:offline', (data: { deviceId: string; reason: string }) => {})

// Spuštění scény
socket.on('scene:started',   (data: { sceneId: string; executionId: string; source: string }) => {})
socket.on('scene:completed', (data: { sceneId: string; executionId: string; durationMs: number }) => {})
socket.on('scene:failed',    (data: { sceneId: string; executionId: string; error: string }) => {})

// Chyba driveru
socket.on('driver:error', (data: { connectionId: string; driverId: string; message: string }) => {})

// Systémové zprávy
socket.on('system:alert', (data: { level: 'info' | 'warn' | 'error'; message: string }) => {})
```

-----

## 10. Admin UI

### Technologie

Vue 3 + Vite + Pinia + Vue Router + TailwindCSS + shadcn-vue. Komunikuje s backendem přes REST API (axios) a Socket.io. Je součástí jediné Vue aplikace (`apps/ui`) sdílené s User UI — admin sekce je dostupná pod cestami `/admin/**`. Běží na portu 4000 (nginx proxy v produkci).

Komponenty ze `shadcn-vue` se používají pro veškeré UI primitivy (formuláře, dialogy, tabulky, toasty, tabs, slidery). Drag & drop v scene editoru a layout builderu zajišťuje `vue-draggable-plus`. WebSocket stav (připojeno/odpojeno) se řeší přímo v Pinia store jako reaktivní ref — bez wrapper composables.

### Architektura — jedna Vue aplikace, route-based layouty (rozhodnutí G7)

Admin portál **není** samostatná aplikace — žije ve **stejné** `apps/ui` jako User
UI, oddělený jen routami a layoutem (tím se uzavírá [DECIDE] **G7** v PLAN.md):

- **`App.vue`** je tenký globální shell — drží jen app-wide lifecycle (jedno
  sdílené `/ws` přes `useRealtimeStore`, hydrataci stores) a `<RouterView/>`.
  Tím obě sekce sdílí jediné WS spojení (respektuje [DECIDE] **E4**).
- **`layouts/UserLayout.vue`** — dosavadní user shell (sidebar, header, command
  palette) pro `/`, `/rooms/:id`, `/schedules`, `/iframes/:id`.
- **`layouts/AdminLayout.vue`** + **`components/layout/AdminSidebar.vue`** — admin
  shell s plnou navigací pro `/admin/**`. Sekce, které ještě nejsou hotové, jsou
  v navigaci vidět jako *disabled* ("soon"), takže je vidět celá informační
  architektura.
- **Routy** jsou vnořené pod layout-rodiči; admin parent nese `meta.admin` a v
  routeru je připravené místo pro auth guard (autentizace je odložená — PLAN P6,
  zatím čistě strukturální oddělení, bez loginu).

#### Implementováno (první řez — Logs + Dashboard)

- **`/admin/logs`** (`views/admin/LogsView.vue`) — strukturovaný prohlížeč logů:
  taby **Logs** / **Executions**, filtry (level, source, entity, časový rozsah),
  stránkování, manuální Refresh + volitelný auto-poll, rozbalitelný detail řádku
  s `metadata` JSON a export aktuální stránky do CSV. Záložka Executions ukazuje
  historii spuštění scén (status, source, doba běhu). Stojí na existujícím
  `GET /logs` a `GET /logs/executions`. **Pozn.:** WS kontrakt zatím nemá `log`
  event, takže prohlížeč je fetch/refresh-based; živý stream logů přes WebSocket
  je samostatný backendový follow-up.
- **`/admin/dashboard`** (`views/admin/DashboardView.vue`) — přehled: zařízení
  online/offline, stav connections, běžící scény, uptime + počet driverů
  (`useSystemStore` nad `GET /system/*`), per-connection status, quick-action
  tlačítka pro oblíbené scény a panel posledních logů.
- **Nové sdílené primitivy** (`components/ui/`): `table`, `tabs`, `badge`,
  `input`, `label` (vendorované stejně jako stávající `button`/`card`/…).
- **Nové stores**: `useSystemStore`, `useLogsStore`; čisté helpery v `lib/logs.ts`
  (unit-testované v `__tests__/logs.spec.ts`).

#### Implementováno (druhý řez — Connections & Devices CRUD)

- **`/admin/connections`** (`views/admin/ConnectionsView.vue`) — tabulka všech
  connections s live stavem (tečka connected/reconnecting/disconnected/disabled),
  přepínačem enable/disable, editací a mazáním (mazání blokuje server 409, dokud
  na connection visí zařízení). Tlačítko *New connection* otevře dialog.
- **`/admin/devices`** (`views/admin/DevicesView.vue`) — tabulka endpointů s
  filtry dle místnosti a typu, online tečkou, enable/disable, editací a mazáním.
- **Dynamické formuláře z manifestu (vee-validate + Zod)** — viz
  https://www.shadcn-vue.com/docs/forms/vee-validate. `ConnectionFormDialog` a
  `DeviceFormDialog` generují pole přímo z driver manifestu:
  - `lib/schemaForm.ts` (unit-testované) převede JSON Schema z manifestu na
    (a) render descriptory, (b) **Zod** schéma zrcadlící serverová Ajv pravidla a
    (c) výchozí hodnoty; `components/admin/SchemaFields.vue` je vykreslí uvnitř
    shadcn-vue `form` (vee-validate) wrapperů.
  - **Connection**: výběr driveru → pole z `connectionSchema`. Při uložení se
    `host`/`port` oddělí do sloupců a zbytek jde do `config` blobu (server je při
    validaci zase spojí). Driver po vytvoření nelze měnit.
  - **Device**: výběr connection → (driver) → typ endpointu → pole z
    `addressSchema` daného endpointu. `capabilities` se odvodí z příkazů endpointu,
    takže je operátor neudržuje ručně.
- **Nové stores / API**: `useDriversStore` (cache manifestů z `GET /drivers`);
  `useConnectionsStore` a `useDevicesStore` mají nově `create`/`update`/`remove`.
  UI nově **type-only** závisí na `@gallery/driver-core` (typy manifestu, smazané
  z bundlu); `api.drivers.*` vrací plný `DriverManifest` (se schématy).
- **Další vendorované primitivy**: `form` (vee-validate), `select`, `dialog`,
  `alert-dialog`, `separator`, `skeleton`, `textarea`, `alert`.

Zbývající admin stránky (rooms, scenes, schedules, mappings, layouts, settings)
přidají další řezy — viz PLAN §"Priority 5 — UI".

### Stránky a funkce

#### `/dashboard` — Dashboard

- Přehled stavu systému: počet zařízení online/offline, aktivní scény, poslední logy (10 řádků)
- Quick-action tlačítka pro oblíbené scény
- Status cards pro každou Connection (online/offline, latence)
- Graf příchozích akcí za posledních 24h (Socket.io live update)

#### `/rooms` — Místnosti

- CRUD správa místností
- Drag & drop pořadí
- Po kliknutí na místnost: přechod na `/rooms/:id/devices`

#### `/connections` — Fyzická připojení

- Seznam Connections s live statusem (zelená/červená tečka z Redis)
- Formulář přidání Connection:
  - Výběr driveru (volá `GET /drivers`, zobrazí manifest)
  - Dynamický formulář generovaný z `connectionSchema` (JSON Schema → formulářové pole)
  - Test připojení
- Tlačítko “Discover” (pokud driver podporuje) — zobrazí nalezené endpointy s možností importu (checkbox seznam → create devices)
- Detail Connection: seznam přiřazených Devices, logy

#### `/devices` — Zařízení (Endpointy)

- Tabulkový přehled s filtrováním dle místnosti, typu, online stavu
- Formulář přidání Device:
  - Výběr Connection (zobrazí driver)
  - Výběr endpoint type (z `manifest.endpointTypes`)
  - Dynamický formulář z `addressSchema`
  - Přiřazení místnosti, jméno, ikona, typ
- Device detail panel:
  - Live stav (level, muted, … dle `stateSchema`)
  - Manuální příkaz — výběr command (z `capabilities`) + dynamický formulář z `paramsSchema`
  - Historie příkazů (logy filtrovány na entity_id)
  - Watchdog status (online, latence, last seen)

#### `/scenes` — Scény

- Grid view scén s ikonami a barvami
- Filtrování dle místnosti, oblíbené, tagy
- Scene detail editor:
  - Metadata (jméno, popis, ikona, barva, místnost, tagy)
  - **Action Timeline editor:**
    - Drag & drop akce do skupin (parallel_group)
    - Každá akce: výběr zařízení → výběr příkazu → formulář params (z manifest)
    - Nastavení delay_ms a on_failure per akce
    - Live preview časové osy (ganttový diagram skupin)
  - Tlačítko “Testovat (dry run)” — spustí scénu s `dryRun: true`, zobrazí log
  - Tlačítko “Spustit” — reálné spuštění
  - Historie verzí — dropdown s verzemi, diff view, tlačítko restore
- Rychlé vytvoření scény z šablony (výběr “Přednáška”, “Projekce”, “Reset místnosti”)

#### `/schedules` — Harmonogramy

- Seznam CRON jobů s příštím spuštěním
- Formulář CRON výrazu s human-readable překladem (cron-parser)
- Toggle enable/disable bez smazání
- Preview příštích 5 spuštění

#### `/mappings` — Vstupní mapování

- Seznam OSC/TCP mapování
- Formulář: protocol, pattern, target (scene nebo device + command), params_template
- Test panel: zadej protocol + adresu + args, uvidíš, co by se stalo

#### `/layouts` — Builder User UI

Low-code builder pro User UI.

- Vizuální editor layoutu: přidávání stránek, přidávání widgetů
- Typy widgetů:
  - `scene_button` — tlačítko spuštění scény (velké/malé, s ikonou)
  - `device_slider` — slider pro zařízení s `setLevel` příkazem
  - `device_toggle` — přepínač on/off
  - `device_status` — live status indikátor (online/offline, aktuální hodnota)
  - `room_header` — nadpis sekce
  - `favorites_row` — automatický řádek oblíbených scén
  - `spacer` — prázdné místo pro vizuální oddělení
- Drag & drop pořadí widgetů
- Mobile preview panel (simulace 375px šířky)
- Uložení + nastavení jako výchozí layout

#### `/logs` — Logy

- Tabulka logů s live update přes WebSocket (nové záznamy se přidají nahoře)
- Filtrování: level, source, entity, časový rozsah
- Export do CSV
- Detail logu (metadata JSON tree)
- Tab “Executions” — přehled spuštění scén s délkou, zdrojem, výsledkem, expandovatelný detail

#### `/settings` — Nastavení

- Systémové nastavení (porty, timeouty watchdog, log retention, …)
- Přehled nainstalovaných driverů (verze, stav subprocess)
- Reload driverů
- Backup/restore konfigurace (export/import PostgreSQL dump)

### Pinia stores

```
useRoomsStore        - cache místností
useConnectionsStore  - connections + live status
useDevicesStore      - devices + live state (Socket.io updates)
useScenesStore       - scény + execution status
useLayoutsStore      - UI layouts
useLogsStore         - real-time log stream
useSystemStore       - system health, connected clients
useDriversStore      - driver manifesty (pro generování formulářů)
```

-----

## 11. User UI

### Technologie

Stejný stack jako Admin UI (Vue 3 + Vite + Pinia + TailwindCSS + shadcn-vue) — je součástí téže Vue aplikace (`apps/ui`). Obě části sdílí Pinia stores, sdílené komponenty a Socket.io připojení. User panel je dostupný pod cestami `/app/**`. Optimalizováno pro dotykové ovládání na tabletu.

#### Implementováno (první řez — device control)

První funkční řez User UI: jedna obrazovka, která zobrazí všechna zařízení jako
ovládací karty (zatím **bez routingu, filtrů, dashboardu a logů**). Slouží jako
demo, že datová cesta funguje od Redisu přes HTTP/WebSocket až do komponent.

- **Tři typy widgetů, modulárně poskládané ze sdílených dílů:**
  - **Brightness fader** (`LightFaderWidget`) — DALI svítidla (`dali.fixture`,
    `dali-foxtron.fixture`), posílá `setBrightness { level }` (0..1).
  - **Fader + mute** (`BssFaderWidget`) — BSS fadery (`bss-soundweb.fader`),
    `setLevel { level }` + `setMute { muted }`.
  - **On/off switch** (`SwitchWidget`) — zásuvky a projektory (`netio.socket`,
    `pjlink.projector`), příkazy `on` / `off`.
  - Mapování `subtype → widget` je na jednom místě (`lib/devices.ts` →
    `deviceKind()`); přidání driveru = jeden řádek.
- **Sdílené, neopakované díly:** `DeviceCard` (karta s názvem zařízení, online
  tečkou a **popisem zařízení jako tooltip on hover**) a `FaderControl`
  (znovupoužitelný slider s procentuálním odečtem), použité oběma fadery.
- **shadcn-vue primitivy** doplněné pro tento řez: `slider`, `tooltip`, `card`
  (vedle už existujících `button`, `switch`, `toggle`, `sonner`).
- **Datová cesta — `useDevicesStore` (`stores/devices.ts`):**
  1. Paralelně `GET /api/v1/devices` (seznam) + `GET /api/v1/devices/live`
     (dávkový snapshot `{ [id]: { state, status } }`) — dva requesty místo
     `1 + 2×N` per-device dotazů na hydrataci živých hodnot z Redisu.
  2. Nativní Bun WebSocket (`/ws`, JSON obálka `{ event, data }`) streamuje
     `device:state` / `device:online` / `device:offline`.
  3. Ovládací příkazy jdou **zpět stejným socketem** jako `device:command`.
     `sendCommand` udělá **optimistický** local update a vrací `Promise<boolean>`,
     který se vyřeší až **`device:command:ack`**: při `success === false` se
     optimistická změna **vrátí zpět** (snapshot dotčených klíčů přes
     `snapshotState` / `applyRevert`) a zobrazí se error toast s hláškou;
     při úspěchu se případný `state` z acku adoptuje (autoritativní hodnota).
     In-flight příkazy jsou per-device FIFO; výpadek socketu je vyřeší jako
     `false` (bez revertu — výsledek je neznámý), aby ack po reconnectu nesedl
     na špatný příkaz.
- **Stav připojení** je reaktivní (`@vueuse/core` `useWebSocket`, auto-reconnect);
  ztráta spojení zobrazí offline banner. Chyby → `vue-sonner` toast.
- Vstupní bod je `App.vue` (žádný router) — Vite dev proxy přeposílá `/api`
  a `/ws` na server (`:3000`).

#### Implementováno (connection status indicator)

Vedle realtime (WiFi) ikony v hlavičce je **indikátor stavu připojení k zařízením**
(`components/connections/ConnectionStatus.vue`) — souhrn typu „7/9“ a rozklikávací
popover se seznamem všech connectionů.

- **Trigger** zobrazí `connected/total` pro **povolené** (enabled) connectiony
  (např. `7/9`) se `ServerIcon`. Je **zelený** pouze když je každý povolený
  connection connected, jinak **červený** — přesně dle pravidla „reconnecting
  nebo disconnected → červená“.
- **Popover** (shadcn-vue `popover` postavený na `reka-ui`, doplněný pro tento řez)
  vypíše každý connection s **barevnou tečkou stavu**: connected (zelená),
  reconnecting (žlutá/amber), disconnected (červená), disabled (šedá). U každého
  je název, typ (`driverId`), textový stav (obarvený), a při chybě i `lastError`
  s výstražnou ikonou. **Switch** vedle každého řádku connection povolí/zakáže
  (`PUT /connections/:id { enabled }` — backend restartuje/zastaví DriverHost;
  odpověď nese aktuální `running` flag, který se optimisticky adoptuje).
- **Odvození stavu** (`lib/connections.ts → connState`): `!enabled → disabled`;
  `status.online → connected`; jinak `running ? reconnecting : disconnected`
  (DriverHost povolený connection auto-restartuje s backoffem, takže „běžící, ale
  offline“ = právě se reconnectuje).
- **Datová cesta — `useConnectionsStore` (`stores/connections.ts`):** paralelně
  `GET /api/v1/connections` (seznam s `running`) + nový **`GET /api/v1/connections/live`**
  (dávkový snapshot `{ [id]: ConnectionStatus }` z Redisu, obdoba `/devices/live`),
  poté live updaty přes `/ws` události `connection:connected` /
  `connection:disconnected` / `driver:error` (které doplní `lastError`).

#### Implementováno (seskupování, podskupiny a filtry)

Nad gridem widgetů je **toolbar** (`components/devices/DeviceToolbar.vue`) s
řádky „chipů“ (zaoblené rohy, ne pilulka — `components/ui/chip/Chip.vue`):

- **Group: `Off` / `Room` / `Type`** — přepíná členění gridu a **dvouúrovňové
  podskupiny**: `Room` seskupí podle místnosti a uvnitř každé místnosti podle
  typu; `Type` naopak (typ → místnosti). Skupina má větší nadpis + počet, každá
  podskupina menší podnadpis nad svým gridem. Při `Off` je jeden plochý grid.
- **Type filter** — chip pro každý přítomný typ (multi-select; prázdný výběr =
  vše) s počtem; **Room filter** — chip pro každou místnost, která má zařízení
  (+ „Unassigned“ pro zařízení bez místnosti), s počtem. Oba mají **Clear**.
- **Prázdné (pod)skupiny se nikdy nevykreslí** — `groupDevices` je staví jen z
  reálně přítomných zařízení, takže po filtru zmizí i celé skupiny/podskupiny.
- **Search bar** (vpravo od filtrů) — volné, víceslovní hledání přes název,
  popis, místnost, typ i subtype; case- a **diakritiku-insensitive** (`Sál`
  matchuje `sal`), všechny termy musí sednout (AND). Aktualizuje se při každém
  stisku. **Když je hledání aktivní, chip filtry se ignorují** (a skryjí) —
  hledá se přes všechna povolená zařízení; seskupení (`groupMode`) ale platí dál.

Logika je v **čistých, testovaných helperech** (`lib/devices.ts`):
`groupDevices(devices, mode, rooms)` → `DeviceGroup[]` s vnořenými `subgroups`
(Room/Type řadí dle `room.displayOrder` → název, nezařazené poslední; Type
abecedně), `filterByTypes`, `filterByRooms`, `roomOptionsOf`, `deviceTypesOf`,
`typeLabel`. Stav (`groupMode`, `typeFilter`, `roomFilter`) i odvozené `groups` /
`filteredDevices` / `typeCounts` / `roomOptions` žijí v `useDevicesStore`; pro
názvy místností store načítá i `GET /api/v1/rooms`. Hledání řeší
`searchDevices(devices, query, rooms)` + `search` / `searching` ve store
(`searching` přepíná `filteredDevices` na výsledky hledání místo chip filtrů).
`DeviceGrid.vue` jen renderuje `store.groups` (a hlásí „No devices match your
search / the selected filters“ podle kontextu). 18 unit testů pokrývá helpery.

#### Implementováno (command palette — ⌘K)

Klávesnicí ovládaný **command palette** (Raycast/Notion styl,
`components/command/CommandPalette.vue`) pro bleskové ovládání jednoho zařízení:

- **⌘K / Ctrl K** (nebo tlačítko „Search ⌘K“ v hlavičce) otevře modální okno;
  **Esc** nebo klik mimo zavře. Globální zkratka + sdílený open-state žijí v
  `composables/useCommandPalette.ts` (singleton), takže okno umí otevřít i
  hlavička bez prop-drillingu.
- **Tok:** napiš (volné hledání jako v gridu — `searchDevices`) → **↑/↓**
  procházej → **↵** vyber zařízení → zobrazí se jeho **akce** (Turn on/off, Mute/
  Unmute, presety 100/50/0 %, Pulse…) odvozené z `capabilities` → **↵** spustí
  (přes `store.sendCommand`, optimisticky + toast). **Esc** / **⌫** na prázdném
  dotazu se vrátí z akcí zpět na hledání. Plně klávesnicová navigace (myš funguje
  taky); řádky se drží ve viewportu, výběr wrapuje.
- **Akce** staví čistý helper `deviceActions(device)` (`lib/commands.ts`) — mapuje
  `capabilities` na param-less / jednoduché příkazy se stejným `command` /
  `params` / `optimistic` tvarem jako widgety; příkazy s parametry (`setInput`,
  `recall`, `send`) vynechává.
- **Scény v paletě:** výsledky jsou plochý seznam `PaletteItem`ů, každý se svým
  `onSelect`. Root view teď řadí **nejdřív scény** („Run scene: …“, jedno **↵** =
  spuštění přes `scenes.execute`) a pak zařízení; obojí používá stejné volné
  hledání. 4 unit testy pro `deviceActions`.

#### Implementováno (scény — `SceneBar` + `useScenesStore`)

Nad gridem (a toolbarem) jsou **tlačítka scén** (`components/scenes/SceneBar.vue`),
vždy navrchu stránky:

- **Spuštění jedním klikem** — `scenes.execute(id)` pošle `POST /api/v1/scenes/:id/
  execute` se `source: "ui"`. Server běží asynchronně (`202 { status: "running" }`);
  tlačítko ukazuje **spinner**, dokud běh trvá. Stav „běží“ řídí WS události
  `scene:started` / `scene:completed` / `scene:failed`, které socket v
  `useDevicesStore` **přesměruje** do `useScenesStore` (`markRunning`/`markFinished`).
  Vnořené sub-scény emitují vlastní události dle `sceneId`, takže si každá maže svůj
  vlastní příznak. 409 (scéna už běží) i další chyby se ukážou jako toast.
- **Které scény jsou vidět** kopíruje filtr gridu: bez filtru **všechny**; při
  aktivním **room filtru** jen scény dané místnosti (scéna bez místnosti → stejný
  „Unassigned“ klíč jako zařízení); při **hledání** scény matchující dotaz (napříč
  všemi). Čisté helpery v `lib/scenes.ts` (`filterScenesByRooms`, `searchScenes`).
- **Tooltip s popisem** (jako u zařízení) + **Lucide ikona** mapovaná z DB pole
  `icon` přes `sceneIcon(name)` (case-insensitive, fallback na generickou ikonu),
  takže scény používají stejnou sadu ikon jako widgety zařízení; volitelná barva
  z `color`. Scény jdou spustit i z command palette. 9 unit testů pro `lib/scenes`.

#### Implementováno (routing + sidebar místností)

User UI je teď **routovaná aplikace** (`vue-router`, `createWebHistory`) s
minimalistickým **sidebarem** (`components/layout/AppSidebar.vue`):

- **Routy:** `/` = „All devices“ (homepage, vše), `/rooms/:roomId` = stránka
  místnosti. URL je zdroj pravdy — **refresh tě nechá na stejné stránce**
  (Vite dev i `vite preview` mají SPA fallback). Neznámé cesty redirectují na `/`.
- **Sidebar** vypíše „All devices“ + každou místnost (řazeno dle `displayOrder`)
  s počtem zařízení; aktivní položka se zvýrazní (`RouterLink` custom slot).
- **Scope ve store:** `App.vue` sleduje `route.params.roomId` a volá
  `store.setRoomScope(...)` (immediate, takže refresh obnoví scope). Toolbar i
  grid běží nad **`scopedDevices`** (= zařízení dané místnosti, nebo všechna na
  homepage); na stránce místnosti se skryje seskupení/filtr „Room“. Změna scope
  resetuje grouping/filtry/hledání. Prázdná místnost hlásí „No devices in this
  room yet.“
- **Command palette zůstává globální** — hledá nad `store.devices` (všechna
  zařízení) bez ohledu na aktuální routu, takže ovládáš cokoli odkudkoli.
- Testy: 3 store testy (scope, počty, reset filtrů) + aktualizovaný App mount
  s routerem (celkem 29).

#### Implementováno (monitoring harmonogramů — `/schedules`, read-only)

User UI má **read-only** stránku pro sledování naplánovaných spuštění
(`views/SchedulesView.vue`, route `/schedules`, položka v sidebaru). Slouží
**jen k monitoringu** — žádné vytváření/úpravy/zapínání (to patří do Admin UI).

- **Data:** `useSchedulesStore` načte `GET /api/v1/schedules`, vyfiltruje
  **enabled** joby a pro každý dotáhne náhled příštích spuštění přes
  `GET /api/v1/schedules/:id/next`. Selhání jednoho náhledu degraduje na prázdný
  seznam, nezhodí stránku.
- **Řazení a zobrazení:** karty jsou řazené dle nejbližšího příštího běhu;
  každá ukazuje cílovou scénu (jméno + Lucide ikona dle scény), nejbližší běh
  (relativně „in 5 minutes" / „tomorrow" + absolutní lokální čas), další
  plánované běhy, cron výraz (+timezone v tooltipu) a poslední běh.
- **Čas:** server vrací vše v **UTC**; převod do lokálního času prohlížeče je
  čistě zobrazovací logika v `lib/schedules.ts` (`formatDateTime`,
  `formatRelative`, `nextRunOf`, `sortByNextRun` — čisté, unit-testované).
- **Aktualizace:** harmonogramy nemají WS událost, takže view se obnovuje
  intervalem (60 s) a tiká `now` (30 s), aby relativní popisky zůstaly svěží.
  Hlavička stránky je řízena `route.meta.title`.
- Testy: 13 unit testů pro helpery v `lib/schedules.ts` (prahové hodnoty
  relativního času, převod timezone, řazení, imutabilita vstupu).

### Princip fungování

User UI nemá vlastní konfiguraci. Celý layout je řízen Admin UI (tabulka `ui_layouts`). Při načtení stránky User UI stáhne aktivní layout přes `GET /api/v1/layouts?default=true` a renderuje widgety dle `config.pages[].widgets`.

### Stránky

#### `/` — Hlavní panel

- Navigační lišta nahoře: jméno galerie, seznam stránek z layoutu (tabs nebo swipe navigation)
- Každá stránka obsahuje grid widgetů dle layoutu
- Widgety:
  - **Scene button:** jméno, ikona, barva. Při kliknutí: optimisticky změní stav na “executing” (spinner), po WebSocket `scene:started` potvrdí. Při `scene:completed` zobrazí checkmark, po 3 sec přejde na idle. Při `scene:failed` ukáže chybový toast.
  - **Device slider:** live hodnota z Redis/Socket.io, debounced emit `device:command` při tahu.
  - **Device toggle:** on/off přepínač, live stav.
  - **Device status:** barevný indikátor online/offline + live hodnota.
  - **Room header:** jen nadpis sekce.
  - **Favorites row:** vodorovný scroll řádek oblíbených scén (napříč místnostmi).

#### `/status` — Přehled stavu

- Jednoduchý přehled: které scény jsou aktivní, která zařízení jsou offline
- Bez editačních možností

### UX pravidla

- Minimální délka reakce na klik: 150ms (vizuální feedback okamžitý, síťový async)
- Toast notifikace pro chyby v levém dolním rohu, auto-dismiss 4s
- Skeleton loading state při prvním načtení
- Offline indikátor pokud Socket.io ztratí spojení (červený banner nahoře)
- Plně responzivní: 375px (phone) → 768px (tablet) → 1024px+ (panel/kiosk)

-----

## 12. Use Cases

### UC-01: Admin přidá BSS SoundWeb a nakonfiguruje mikrofony

**Předpoklady:** Server běží, Admin UI je dostupné na `/admin`.

1. Admin otevře `/connections` → klikne “Přidat connection”
1. Vybere driver `bss-soundweb`
1. Formulář (generovaný z `connectionSchema`) zobrazí pole: IP adresa, Port (default 1023), Node ID
1. Admin vyplní: `192.168.1.50`, `1023`, `1` → klikne “Otestovat” → system ověří TCP spojení
1. Uloží → API vytvoří Connection záznam, DriverHost spustí subprocess, driver se připojí
1. Admin přejde na `/devices` → “Přidat zařízení”
1. Vybere Connection: “BSS @ 192.168.1.50”
1. Vybere endpoint type: `bss.fader`
1. Formulář zobrazí adresu: Virtual Device (0-255), Object, Parameter
1. Admin vyplní adresu mikrofonu ze scény (např. 3, 0, 0) → jméno “Mikrofon scéna” → místnost “Sál A” → typ “microphone”
1. Uloží → Device vytvořen, viditelný v `/devices` s live statusem
1. Admin zopakuje pro každý mikrofon a master fader

### UC-02: Admin vytvoří scénu “Přednáška sál A”

1. Admin otevře `/scenes` → “Nová scéna”
1. Vyplní jméno, ikonu, barvu, místnost: Sál A
1. V Timeline editoru přidá akce do skupin:
- Group 0 (paralelně):
  - `Závěsy sál A` → `close` → delay 0ms
  - `Světla sál A ambient` → `setBrightness` → `{level: 0.3}` → delay 0ms
- Group 1 (po group 0):
  - `Projektor Barco` → `on` → delay 0ms
- Group 2 (po group 1):
  - `Projektor Barco` → `setInput` → `{input: "HDMI1"}` → delay 3000ms (čeká na najetí)
  - `Mikrofon scéna` → `setMute` → `{muted: false}` → delay 0ms
  - `Master sál A` → `setLevel` → `{level: 0.7}` → delay 0ms
1. Klikne “Testovat (dry run)” → vidí log simulovaných akcí, ověří pořadí
1. Uloží → scéna je dostupná

### UC-03: Admin vytvoří User UI layout pro operátora sálu

1. Admin otevře `/layouts` → “Nový layout”
1. Přejmenuje na “Panel sál A”
1. Přidá stránku “Sál A”
1. Přidá widgety:
- Room header: “Sál A”
- Scene button (large): “Přednáška” → scene_id
- Scene button (large): “Diskuze” → scene_id
- Scene button (large): “Přestávka” → scene_id
- Scene button (large): “Reset” → scene_id
- Oddělovač
- Device slider: “Světla” → device_id (master lighting)
- Device slider: “Hlasitost” → device_id (master audio)
1. Mobile preview zobrazí výsledek na 375px šířce
1. Uloží, nastaví jako výchozí

### UC-04: Operátor spustí scénu z User UI

1. Operátor otevře User UI na tabletu → vidí page “Sál A” se čtyřmi tlačítky
1. Klikne na “Přednáška”
1. Tlačítko okamžitě změní stav na “executing” (spinner) — optimistické UI
1. Server přijme WebSocket `scene:execute`
1. SceneEngine spustí scénu (group 0 → group 1 → group 2)
1. Každá změna stavu zařízení je broadcastována přes WebSocket
1. Sliders v UI live updatují hodnoty jak se mění (světla se tlumí)
1. Po dokončení: WebSocket `scene:completed` → tlačítko “Přednáška” se zeleně podbarví → po 3s idle stav
1. Pokud selže (např. projektor offline): WebSocket `scene:failed` → červený toast “Scéna selhala: Projektor offline”

### UC-05: Automatické spuštění scény harmonogramem

1. Admin vytvoří Scheduled Job: scéna “Otevření galerie”, CRON `0 9 * * 2-6`, timezone Europe/Prague
1. Každý pracovní den v 9:00 Scheduler automaticky spustí scénu
1. SceneEngine spustí scénu se `source: 'scheduler'`
1. Log zaznamená: `{ source: 'scheduler', job_id: 'uuid', scene_id: 'uuid' }`
1. Všechny připojené UI dostanou WebSocket broadcast `scene:started`

### UC-06: Spuštění scény přes OSC z vMix

1. Admin vytvoří InputMapping: protocol `osc`, pattern `/gallery/scene/:id/execute`, target_type `scene.execute`
1. vMix odešle OSC zprávu na UDP port 8765: adresa `/gallery/scene/abc-123/execute`
1. OscServer přijme zprávu, matchne pattern, extrahuje `id = "abc-123"`
1. Spustí `SceneEngine.executeScene("abc-123", "osc:/gallery/scene")`
1. Scéna se spustí, loguje source `osc:/gallery/scene/:id/execute`

### UC-07: Spuštění příkazu přes HTTP API

Příklad: integrace s kiosk systémem nebo interaktivní instalací.

```bash
POST /api/v1/scenes/abc-123/execute
Content-Type: application/json

{ "source": "kiosk-entrance" }
```

Odpověď:

```json
{ "executionId": "exec-uuid", "sceneId": "abc-123", "status": "started" }
```

### UC-08: Watchdog detekuje výpadek BSS

1. Watchdog odešle healthCheck subprocesu BSS driveru
1. TCP socket vrátí ECONNREFUSED (BSS byl restartován)
1. Driver emituje `disconnected` event
1. DriverHost propaguje na EventBus jako `connection.disconnected`
1. DeviceManager označí všechny endpointy dané Connection jako offline v Redis
1. EventBus emituje `device.offline` pro každý dotčený endpoint
1. WebSocket broadcast `device:offline` všem klientům — UI zobrazí červené tečky
1. DriverHost spustí exponenciální reconnect (1s, 2s, 4s, …)
1. Po úspěšném reconnect: EventBus `connection.connected` → `device.online` pro každý endpoint → UI přejde zpět na zelenou

### UC-09: Admin upraví scénu, pak obnoví starší verzi

1. Scéna “Vernisáž” má verzi 3 (aktuální)
1. Admin omylem smaže akci a uloží → vznikne verze 4
1. Admin otevře `/scenes/vernisaz` → záložka “Verze”
1. Vidí verze 1-4 s timestamps
1. Klikne na verzi 3 → zobrazí snapshot akcí
1. Klikne “Obnovit tuto verzi” → API vytvoří verzi 5 identickou s verzí 3 (neztrácí historii)

### UC-10: DALI discovery a import světel

1. Admin přidá Connection: driver `dali`, IP `192.168.1.20`
1. Driver subprocess se připojí k gateway
1. Admin klikne “Discover” na Connection detail stránce
1. Driver zavolá `discoverEndpoints()` — naskenuje DALI adresy 0-63
1. API vrátí seznam nalezených endpointů: `[{type: 'dali.fixture', address: {dali: 1}, name: 'DALI 1'}, ...]`
1. Admin UI zobrazí checkbox seznam 24 nalezených světel
1. Admin označí 16 z nich, nastaví jim jména (“Spot scéna 1-8”, “Wash hlavní 1-8”), přiřadí místnosti
1. Klikne “Importovat vybrané” → vytvoří 16 Device záznamů

-----

## 13. Event flows — detailní průtoky

### Flow A: User UI click → fyzické zařízení → zpět do UI

```
[User UI]
  Vue <SceneTile @click="handleClick">
  → Pinia store: setScenesState(sceneId, 'executing')
  → socket.emit('scene:execute', { sceneId })
  → UI okamžitě ukáže spinner (optimistické UI)

[API Gateway — Fastify WebSocket handler]
  → Validace: scéna existuje? enabled? (dotaz do DB cache)
  → Generuje executionId = uuid()
  → Odpoví ack: { executionId }
  → EventBus.emit('scene.execute.requested', { sceneId, source: 'userui', executionId })

[SceneEngine — naslouchá 'scene.execute.requested']
  → Načte scene + scene_actions z PostgreSQL
  → Seřadí akce do execution plánu (skupiny)
  → Zaznamená pre-state dotčených zařízení (pokud rollback je možný)
  → INSERT INTO scene_executions (status='running')
  → Redis: SET scene:{id}:active "1"
  → EventBus.emit('scene.execute.started', { sceneId, executionId })

[API Gateway naslouchá 'scene.execute.started']
  → io.emit('scene:started', { sceneId, executionId, source: 'userui' })

[User UI přijme 'scene:started']
  → nic moc — spinner stále běží

[SceneEngine — provádí skupiny]
  Group 0: Promise.all([
    DeviceManager.execute(zavesyId, 'close', {}),
    DeviceManager.execute(svetlaId, 'setBrightness', { level: 0.3 })
  ])

[DeviceManager.execute]
  → Načte Device z cache: { connectionId, type, address, ... }
  → DriverHost.executeCommand(connectionId, endpointDescriptor, 'close', {})

[DriverHost — IPC message do subprocess]
  → process.send({ type: 'executeCommand', requestId, endpoint, command, params })

[Driver subprocess — fyzicky pošle příkaz]
  → TCP zpráva na fyzické zařízení
  → Čeká na odpověď (timeout 500ms)
  → process.send({ type: 'reply', requestId, result: { success: true, durationMs: 23 } })

[DriverHost — přijme reply]
  → Resolvuje Promise pro DeviceManager

[DeviceManager — výsledek]
  → Redis: SET device:{id}:state { brightness: 0.3 }
  → EventBus.emit('device.state.changed', { deviceId, state, source: 'scene' })

[API Gateway naslouchá 'device.state.changed']
  → io.emit('device:state', { deviceId, state, source: 'scene', timestamp })

[User UI přijme 'device:state']
  → Pinia devicesStore.updateState(deviceId, state)
  → Pokud je na stránce slider pro toto zařízení: live update hodnoty

[SceneEngine — po dokončení všech skupin]
  → UPDATE scene_executions SET status='completed', completed_at=NOW(), duration_ms=...
  → Redis: DEL scene:{id}:active
  → EventBus.emit('scene.execute.completed', { sceneId, executionId, durationMs })

[API Gateway naslouchá 'scene.execute.completed']
  → io.emit('scene:completed', { sceneId, executionId, durationMs })

[User UI přijme 'scene:completed']
  → Pinia store: setScenesState(sceneId, 'active')
  → SceneTile zobrazí checkmark
  → setTimeout(3000) → setScenesState(sceneId, 'idle')
```

### Flow B: DriverHost restart po pádu subprocess

```
[OS / Bun]
  Subprocess pro Connection "BSS @ 192.168.1.50" náhle ukončen (exit code != 0)

[DriverHost — 'exit' event na ChildProcess]
  → Log: WARN "Driver subprocess crashed: bss-soundweb, attempt 3/∞"
  → EventBus.emit('system.driver.crashed', { connectionId, driverId, error })
  → Vypočítat delay = min(1000 * 2^attempt, 30000) = 4000ms
  → setTimeout(4000, restartSubprocess)

[DeviceManager naslouchá 'system.driver.crashed']
  → Pro každý Device s tímto connectionId:
    → Redis: SET connection:{id}:status { online: false }
    → Redis: SET device:{id}:status { online: false }
    → EventBus.emit('device.offline', { deviceId, connectionId, reason: 'driver_crashed' })

[API Gateway naslouchá 'device.offline']
  → io.emit('device:offline', { deviceId, reason: 'driver_crashed' })

[User UI přijme 'device:offline']
  → Pinia devicesStore.setOnline(deviceId, false)
  → Status tečka přejde na červenou

[DriverHost po 4000ms — restart subprocess]
  → fork() nový subprocess
  → IPC: send({ type: 'init', config })
  → IPC: send({ type: 'connect' })

[Driver subprocess]
  → Pokouší se o TCP spojení
  → Úspěch: IPC: send({ type: 'connected' })

[DriverHost — přijme 'connected']
  → attempt reset na 0
  → EventBus.emit('connection.connected', { connectionId })

[DeviceManager]
  → Redis: SET connection:{id}:status { online: true, latencyMs: 12 }
  → Pro každý Device tohoto connectionId:
    → EventBus.emit('device.online', { deviceId })

[API Gateway → io.emit('device:online', ...)]

[User UI]
  → Tečky zpět na zelenou
```

-----

## 14. Jak napsat nový driver

Nový driver je npm balíček v `packages/drivers/driver-{jméno}/`. Nejjednodušší start je zkopírovat `driver-template`.

### Krok 1: Definuj manifest

Soubor `src/manifest.ts`:

```typescript
import type { DriverManifest } from '@gallery/driver-core';

export const manifest: DriverManifest = {
  id: 'muj-driver',           // unikátní, kebab-case, bez mezer
  name: 'Moje zařízení',
  version: '0.1.0',
  vendor: 'Výrobce XY',

  connectionSchema: {
    type: 'object',
    required: ['host', 'port'],
    properties: {
      host: { type: 'string', format: 'ipv4', title: 'IP adresa' },
      port: { type: 'integer', default: 12345 }
    }
  },

  capabilities: {
    discovery: false,
    subscriptions: false,
    bidirectional: true
  },

  endpointTypes: [
    {
      type: 'muj-driver.channel',
      name: 'Kanál',
      addressSchema: {
        type: 'object',
        required: ['channel'],
        properties: {
          channel: { type: 'integer', minimum: 1, maximum: 16 }
        }
      },
      stateSchema: {
        type: 'object',
        properties: {
          level: { type: 'number', minimum: 0, maximum: 1 }
        }
      },
      commands: [
        {
          command: 'setLevel',
          description: 'Nastavit úroveň 0..1',
          reversible: true,
          paramsSchema: {
            type: 'object',
            required: ['level'],
            properties: { level: { type: 'number', minimum: 0, maximum: 1 } }
          }
        }
      ]
    }
  ]
};
```

### Krok 2: Implementuj driver třídu

Soubor `src/MyDriver.ts`:

```typescript
import { EventEmitter } from 'events';
import type { IDeviceDriver, ConnectionConfig, DriverContext,
              EndpointDescriptor, CommandResult, HealthStatus } from '@gallery/driver-core';
import { manifest } from './manifest';

export class MyDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private config!: ConnectionConfig;
  private ctx!: DriverContext;
  private connected = false;
  // sem patří socket, reconnect timer, pending requests, ...

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.config = config;
    this.ctx = ctx;
  }

  async connect(): Promise<void> {
    // TODO: otevřít socket, při úspěchu:
    this.connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    // TODO: zavřít socket, při dokončení:
    this.connected = false;
  }

  async destroy(): Promise<void> {
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean { return this.connected; }

  async healthCheck(): Promise<HealthStatus> {
    return { online: this.connected, checkedAt: new Date() };
  }

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>
  ): Promise<CommandResult> {
    if (this.ctx.dryRun) {
      this.ctx.logger.info('Dry run', { command, params });
      return { success: true, durationMs: 0 };
    }

    const start = Date.now();
    try {
      // TODO: přeložit command + params na TCP/UDP zprávu, odeslat, čekat na odpověď
      return { success: true, durationMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, durationMs: Date.now() - start, error: err.message };
    }
  }

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    // TODO: dotaz na zařízení na aktuální stav
    return {};
  }
}
```

### Krok 3: Exportuj z index.ts

```typescript
// src/index.ts
export { manifest } from './manifest';
export { MyDriver as default } from './MyDriver';
```

### Krok 4: Přidej do package.json

```json
{
  "name": "@gallery/driver-muj-driver",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

### Krok 5: Zaregistruj driver

V `apps/server/src/core/DriverRegistry.ts` přidej do pole driverů:

```typescript
import MujDriver, { manifest as mujManifest } from '@gallery/driver-muj-driver';

const DRIVERS: DriverRegistration[] = [
  // ... stávající drivery
  { manifest: mujManifest, DriverClass: MujDriver }
];
```

Po restartu serveru je driver dostupný v Admin UI.

### Pravidla pro driver autory

- Driver **nikdy** nespouští `process.exit()` — při fatální chybě emituje `error` event s `level: 'fatal'` a čeká na `destroy()`
- Driver **vždy** implementuje reconnect logiku s exponenciálním backoff
- Driver **musí** respektovat `ctx.signal` (AbortSignal) — při jeho zrušení: gracefully disconnect
- Driver **musí** respektovat `ctx.dryRun` — žádné TCP příkazy v dry-run módu
- Driver **nesmí** importovat z `@gallery/server` ani přistupovat do DB
- Driver **musí** logovat smysluplně přes `ctx.logger`, ne přes `console.log`
- Timeout pro `executeCommand` by měl být konfigurovatelný (default 500ms pro synchronní příkazy)

### Implementované drivery

| Driver (id) | Zařízení | Transport | Capabilities |
|---|---|---|---|
| `pjlink` | PJLink projektory (Class 1) | TCP 4352, ASCII | bidirectional |
| `tcp-generic` | Libovolné jednoduché TCP zařízení | TCP, raw | bidirectional |
| `dali-lunatone` | Lunatone DALI-2 IoT gateway | HTTP REST, port 80 | discovery, bidirectional |

**`driver-template`** — kostra pro nový driver. Na rozdíl od většiny šablon je to
**funkční** mini-driver (hračkový ASCII line-protokol) s `// TODO` komentářem v každé
metodě. Balíček je soběstačný: driver, jeho mock (`test/mock-device.ts`) i 6 testů
(`test/template.test.ts` — connect, command, readState, dry-run, unknown-command,
disconnect) leží pohromadě, takže nový driver vznikne zkopírováním jediné složky a
testy projdou hned po startu.

**`driver-dali-lunatone`** — Lunatone **DALI-2 IoT** modul (Art.Nr. 89453886).
⚠️ **Korekce protokolu oproti plánu:** plán předpokládal textový TCP protokol
(`>A {addr} ...<`), ale reálné zařízení (dle přiloženého manuálu v
`manuals/`) komunikuje přes **HTTP REST + JSON API na portu 80** bez autentizace.
Driver je implementován proti skutečnému API (Bun-native `fetch`, žádné externí
závislosti):

- `GET /info` — health/reachability probe (connect i `healthCheck`)
- `POST /device/{id}/control` — `ControlData` objekt: `on`/`off` → `{switchable}`,
  `setBrightness {level 0..1}` → `{dimmable 0..100}`, `recall {scene 0..15}` → `{scene}`
- `GET /device/{id}` + `GET /devices` — čtení stavu (`switchable.status`,
  `dimmable.status`) a discovery
- `POST /dali/scan` + `GET /dali/scan` — sken sběrnice (volitelně přes `scanOnDiscover`,
  ~1 min, pollováno)

**Klíčové rozhodnutí — adresace:** zařízení se ovládá přes *identifikační číslo*
gateway (`deviceId`, přidělené při skenu), které se **liší** od raw DALI short
adresy (0..63). Endpoint adresa je proto `{ deviceId, daliAddress? }`, kde
`daliAddress` je jen read-only metadata z discovery.

-----

## 15. Deployment — Docker Compose

### docker-compose.yml (produkce)

```yaml
version: '3.9'

services:
  server:
    build: ./apps/server
    restart: unless-stopped
    ports:
      - "3000:3000"     # HTTP API + WebSocket
      - "8765:8765/udp" # OSC input
      - "8766:8766"     # TCP input
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://gallery:${DB_PASSWORD}@postgres:5432/gallery
      - REDIS_URL=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - gallery_net
    volumes:
      - server_logs:/app/logs

  ui:
    build: ./apps/ui
    restart: unless-stopped
    ports:
      - "4000:80"    # /admin/** → admin portal, /app/** → user panel
    environment:
      - VITE_API_URL=http://server:3000
    depends_on:
      - server
    networks:
      - gallery_net

  postgres:
    image: timescale/timescaledb:latest-pg16
    restart: unless-stopped
    environment:
      POSTGRES_DB: gallery
      POSTGRES_USER: gallery
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gallery"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - gallery_net

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save 60 1
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks:
      - gallery_net

volumes:
  postgres_data:
  redis_data:
  server_logs:

networks:
  gallery_net:
    driver: bridge
```

### docker-compose.dev.yml (development override)

```yaml
version: '3.9'

services:
  server:
    build:
      context: ./apps/server
      target: dev
    volumes:
      - ./apps/server/src:/app/src  # hot reload
      - ./packages:/app/node_modules/@gallery  # live packages
    command: pnpm dev
    environment:
      - NODE_ENV=development
      - LOG_LEVEL=debug

  ui:
    build:
      context: ./apps/ui
      target: dev
    volumes:
      - ./apps/ui/src:/app/src
    command: pnpm dev --host
    ports:
      - "4000:4000"
```

Spuštění v dev módu: `docker-compose -f docker-compose.yml -f docker-compose.dev.yml up`

-----

## 16. Proměnné prostředí a konfigurace

### .env.example

```bash
# Databáze
DB_PASSWORD=silne_heslo_postgres
DATABASE_URL=postgresql://gallery:${DB_PASSWORD}@localhost:5432/gallery

# Redis
REDIS_URL=redis://localhost:6379

# Server
PORT=3000
LOG_LEVEL=info               # debug | info | warn | error
NODE_ENV=production

# OSC vstup
OSC_PORT=8765

# TCP vstup
TCP_INPUT_PORT=8766

# Watchdog
WATCHDOG_CONNECTION_INTERVAL_MS=10000    # jak často pingovat connections
WATCHDOG_ENDPOINT_INTERVAL_MS=60000     # jak často pingovat endpointy

# Driver subprocess
DRIVER_RESTART_MAX_ATTEMPTS=0    # 0 = neomezeně
DRIVER_RESTART_BASE_DELAY_MS=1000
DRIVER_RESTART_MAX_DELAY_MS=30000

# Logy
LOG_RETENTION_DAYS=90
LOG_FILE_PATH=./logs/gallery.log
```

### Runtime konfigurace

Část nastavení je uložena v DB v tabulce `config` (key-value):

```sql
CREATE TABLE config (
  key   VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Příklady hodnot:
-- gallery.name = "Národní galerie Praha"
-- gallery.timezone = "Europe/Prague"
-- ui.theme = "dark"
-- scene.conflict_strategy = "queue" | "abort_current" | "ignore"
```

-----

## 17. Budoucí rozšíření

### 17.1 MCP Server pro LLM ovládání

Přidat `apps/mcp-server/` jako samostatný Bun proces. Komunikuje s `apps/server` výhradně přes HTTP API (volá `/api/v1/...`). Vystavuje tools pro LLM:

```typescript
// Příklady MCP tools
tools: [
  { name: 'list_rooms', description: 'Vrátí seznam místností galerie' },
  { name: 'list_scenes', description: 'Vrátí scény, volitelně filtrované dle místnosti', inputSchema: { room_id?: string, query?: string } },
  { name: 'execute_scene', description: 'Spustí scénu podle ID nebo jména', inputSchema: { scene_id?: string, name?: string } },
  { name: 'list_devices', description: 'Vrátí zařízení s jejich aktuálním stavem', inputSchema: { room_id?: string, type?: string } },
  { name: 'set_device_state', description: 'Pošle příkaz na zařízení', inputSchema: { device_id: string, command: string, params: object } },
  { name: 'create_scene', description: 'Vytvoří novou scénu podle popisu', inputSchema: { name: string, room_id?: string, actions: Array<...> } },
  { name: 'query_logs', description: 'Vrátí logy za dané časové období', inputSchema: { from?: string, to?: string, level?: string } },
  { name: 'get_system_status', description: 'Vrátí celkový stav systému' }
]
```

Integrace s Claude API nebo jiným LLM providerem. Admin UI dostane “AI asistent” panel — chat input, kde admin píše přirozenou řečí. User UI volitelně dostane “chat” tlačítko s omezenějšími oprávněními (jen execute scene, read state).

### 17.2 Autentizace a role

Schema je připraveno (`created_by` sloupce, `ui_layouts` separované od users). Pro přidání auth:

1. Přidat tabulku `users` (id, name, role: ‘admin’ | ‘operator’ | ‘viewer’, password_hash, created_at)
1. Přidat tabulku `sessions` nebo JWT middleware do Fastify
1. Přidat `required_role` sloupec do `scenes` a `devices`
1. API Gateway middleware zkontroluje roli před každým requestem
1. User UI dostane login screen (pokud auth je zapnutá)

Přepínač `AUTH_ENABLED=false` v .env umožní běh bez auth (aktuální stav).

### 17.3 Multi-uživatelský User UI

- Každý layout přiřazen roli nebo konkrétnímu uživateli
- Oblíbené scény per-uživatel (tabulka `user_favorites`)
- Activity log “kdo spustil co” namísto generického “admin”

### 17.4 Mobilní aplikace

REST API a WebSocket jsou identické pro web i mobilní klient. User UI je již responzivní. Pokud bude potřeba nativní app: API je připravené, auth middleware bude stačit rozšířit o OAuth nebo API klíče.

### 17.5 Pluginové widgety pro User UI

Admin UI builder je navržen tak, aby šlo přidat nový typ widgetu jako Vue komponentu + definici schématu. Budoucí widgety: kamera feed, časomíra, počítadlo návštěvníků, interaktivní mapa galerie.

-----

## Appendix A: Konvence pojmenování

- **Databáze:** `snake_case` pro tabulky i sloupce, UUID jako PK
- **TypeScript:** `camelCase` pro proměnné a metody, `PascalCase` pro třídy a typy, `SCREAMING_SNAKE_CASE` pro konstanty
- **API URL:** `kebab-case` pro resource paths (`/scene-actions`, ne `/sceneActions`)
- **Driver ID:** `kebab-case` bez vendor prefixu (`bss-soundweb`, ne `harman-bss-soundweb`)
- **Endpoint type:** `driver-id.type` formát (`bss-soundweb.fader`, `dali.fixture`)
- **EventBus události:** `domain.noun.verb` formát (`scene.execute.started`, `device.state.changed`)
- **Redis klíče:** `entity:{uuid}:property` formát (`device:abc123:state`)

## Appendix B: Chybové kódy API

```
400 BAD_REQUEST         - Nevalidní vstup (detail v 'details')
400 VALIDATION          - Vstup neodpovídá schématu driveru — Ajv chyby v 'details'
404 NOT_FOUND           - Entita nenalezena
409 CONFLICT            - Konflikt (např. scéna běží, connection má devices)
422 UNPROCESSABLE       - Validní JSON ale nevalidní business logika
503 DRIVER_UNAVAILABLE  - Driver subprocess není dostupný
500 INTERNAL_ERROR      - Neočekávaná chyba serveru
```

## Appendix C: Testovací strategie

- **Unit testy** (Vitest): Driver logika (mockovaný socket), SceneEngine (mockovaný DeviceManager), InputMapper (pattern matching)
- **Integration testy** (Vitest + testcontainers): API endpointy s reálnou PostgreSQL a Redis
- **Driver testy:** Každý driver balíček má mock TCP server simulující fyzické zařízení pro testování bez hardwaru
- **E2E testy** (Playwright): Klíčové user flows v Admin UI a User UI
