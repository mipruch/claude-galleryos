/**
 * Seed script — inserts sample data so the core can start drivers without an
 * admin UI. Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
 *
 * Run with `bun run seed` (from apps/server) or `bun src/db/seed.ts`.
 *
 * NOTE: host addresses are placeholders — swap them for your real device IPs.
 *   BSS:  TCP 1023, node address comes from Audio Architect → Venue Explorer.
 *   DALI: HTTP port 80, deviceId from the Lunatone IoT gateway's device scan.
 */

import { logger } from "../logger.ts";
import { closeDb, db } from "./client.ts";
import { connections, devices, rooms } from "./schema.ts";

const log = logger.child("seed");

// ── fixed UUIDs (idempotent) ─────────────────────────────────
// Rooms
const ROOM_HALL  = "11111111-1111-1111-1111-111111111111";
const ROOM_FOYER = "11111111-1111-1111-1111-111111111112";

// Connections
const CONN_PJLINK = "22222222-2222-2222-2222-222222222222";
const CONN_TCP    = "33333333-3333-3333-3333-333333333333";
const CONN_BSS    = "22222222-2222-2222-2222-222222222244"; // BSS BLU-100 processor
const CONN_DALI   = "22222222-2222-2222-2222-222222222255"; // Lunatone DALI-2 IoT gateway
const CONN_NETIO  = "22222222-2222-2222-2222-222222222266"; // NETIO PowerBOX 4Kx

// Devices
const DEV_PROJECTOR   = "44444444-4444-4444-4444-444444444444";
const DEV_CURTAIN     = "55555555-5555-5555-5555-555555555555";
// BSS faders (node 0x1DFE = BLU-100 default from Audio Architect, vd=3 Audio)
const DEV_BSS_MIC1    = "55555555-5555-5555-5555-555555555601"; // Mic input 1
const DEV_BSS_MIC2    = "55555555-5555-5555-5555-555555555602"; // Mic input 2
const DEV_BSS_MAIN_L  = "55555555-5555-5555-5555-555555555603"; // Main bus L
const DEV_BSS_MAIN_R  = "55555555-5555-5555-5555-555555555604"; // Main bus R
const DEV_BSS_AUX     = "55555555-5555-5555-5555-555555555605"; // Aux send
// DALI fixtures (deviceId = gateway's identifying number from a bus scan)
const DEV_DALI_SPOT1  = "55555555-5555-5555-5555-555555555701"; // Spot 1 (DALI addr 0)
const DEV_DALI_SPOT2  = "55555555-5555-5555-5555-555555555702"; // Spot 2 (DALI addr 1)
const DEV_DALI_WASH1  = "55555555-5555-5555-5555-555555555703"; // Wash 1 (DALI addr 8)
const DEV_DALI_WASH2  = "55555555-5555-5555-5555-555555555704"; // Wash 2 (DALI addr 9)
const DEV_DALI_AMBIENT  = "55555555-5555-5555-5555-555555555705"; // Ambient strip (DALI addr 16)
// NETIO sockets (outputId = outlet number on the PowerBOX, 1-based)
const DEV_NETIO_SOCK1   = "55555555-5555-5555-5555-555555555801"; // Socket 1
const DEV_NETIO_SOCK2   = "55555555-5555-5555-5555-555555555802"; // Socket 2
const DEV_NETIO_SOCK3   = "55555555-5555-5555-5555-555555555803"; // Socket 3
const DEV_NETIO_SOCK4   = "55555555-5555-5555-5555-555555555804"; // Socket 4

async function main(): Promise<void> {
  // ── rooms ───────────────────────────────────────────────────
  await db
    .insert(rooms)
    .values([
      {
        id: ROOM_HALL,
        name: "Hlavní sál",
        description: "Main exhibition hall",
        icon: "building",
        color: "#3B82F6",
        displayOrder: 0,
      },
      {
        id: ROOM_FOYER,
        name: "Foyer",
        description: "Entrance foyer",
        icon: "door-open",
        color: "#10B981",
        displayOrder: 1,
      },
    ])
    .onConflictDoNothing();

  // ── connections ──────────────────────────────────────────────
  await db
    .insert(connections)
    .values([
      {
        id: CONN_PJLINK,
        name: "Projektor (PJLink)",
        driverId: "pjlink",
        host: "192.168.1.50",
        port: 4352,
        protocol: "tcp",
        config: {},
      },
      {
        id: CONN_TCP,
        name: "Závěsy (TCP)",
        driverId: "tcp-generic",
        host: "192.168.1.60",
        port: 5000,
        protocol: "tcp",
        config: { txDelimiter: "\\r\\n", rxDelimiter: "\\r\\n" },
      },
      {
        id: CONN_BSS,
        name: "BSS BLU-100 (sál)",
        driverId: "bss-soundweb",
        // ↓ Change to your BLU-100's IP. Default London DI port is 1023.
        host: "192.168.1.100",
        port: 1023,
        protocol: "tcp",
        config: {
          responseTimeoutMs: 2000,
          reconnectMs: 2000,
        },
      },
      {
        id: CONN_DALI,
        name: "Lunatone DALI-2 IoT (sál)",
        driverId: "dali-lunatone",
        // ↓ Change to your Lunatone gateway's IP. REST API on port 80.
        host: "192.168.1.101",
        port: 80,
        protocol: "tcp",
        config: {
          responseTimeoutMs: 4000,
          // Set to true to trigger a DALI bus scan on discoverEndpoints().
          scanOnDiscover: false,
        },
      },
    ])
    .onConflictDoNothing();

  // ── devices: PJLink + TCP (existing) ────────────────────────
  await db
    .insert(devices)
    .values([
      {
        id: DEV_PROJECTOR,
        connectionId: CONN_PJLINK,
        roomId: ROOM_HALL,
        name: "Projektor Barco",
        type: "video",
        subtype: "pjlink.projector",
        address: {},
        capabilities: ["on", "off", "setInput", "setMute"],
        icon: "projector",
        displayOrder: 0,
      },
      {
        id: DEV_CURTAIN,
        connectionId: CONN_TCP,
        roomId: ROOM_HALL,
        name: "Závěsy sál",
        type: "blind",
        subtype: "tcp-generic.endpoint",
        address: { label: "curtain-hall" },
        capabilities: ["send"],
        icon: "curtains",
        displayOrder: 1,
      },
    ])
    .onConflictDoNothing();

  // ── devices: BSS faders ──────────────────────────────────────
  //
  // Address fields (from Audio Architect → Venue Explorer):
  //   node:          The Node Address of the BLU-100 (2-byte value shown in the
  //                  Room view, e.g. 0x1DFE = 7678).
  //   virtualDevice: Always 3 for Audio processing objects.
  //   object:        The Processing Object ID (shown in Properties when the Gain
  //                  block is selected, e.g. 0x000109 = 265).
  //   gainParam:     Parameter ID for the level fader (typically 0x0060 = 96).
  //   muteParam:     Parameter ID for the mute switch  (typically 0x0061 = 97).
  //
  // These are PLACEHOLDER values matching the bss.js test script.
  // Read your actual values from Audio Architect and update them here.
  await db
    .insert(devices)
    .values([
      {
        id: DEV_BSS_MIC1,
        connectionId: CONN_BSS,
        roomId: ROOM_HALL,
        name: "BSS Mic 1",
        description: "Microphone input fader 1 — BLU-100 sál",
        type: "audio",
        subtype: "bss-soundweb.fader",
        address: {
          node: 0x1dfe,        // 7678 — change to your device's node address
          virtualDevice: 3,
          object: 0x000109,    // 265  — change to your Gain object ID
          gainParam: 0x0060,   // 96   — level parameter
          muteParam: 0x0061,   // 97   — mute parameter
        },
        capabilities: ["setLevel", "setMute"],
        icon: "microphone",
        displayOrder: 10,
      },
      {
        id: DEV_BSS_MIC2,
        connectionId: CONN_BSS,
        roomId: ROOM_HALL,
        name: "BSS Mic 2",
        description: "Microphone input fader 2 — BLU-100 sál",
        type: "audio",
        subtype: "bss-soundweb.fader",
        address: {
          node: 0x1dfe,
          virtualDevice: 3,
          object: 0x000110,    // next Gain object
          gainParam: 0x0060,
          muteParam: 0x0061,
        },
        capabilities: ["setLevel", "setMute"],
        icon: "microphone",
        displayOrder: 11,
      },
      {
        id: DEV_BSS_MAIN_L,
        connectionId: CONN_BSS,
        roomId: ROOM_HALL,
        name: "BSS Main L",
        description: "Main output bus Left — BLU-100 sál",
        type: "audio",
        subtype: "bss-soundweb.fader",
        address: {
          node: 0x1dfe,
          virtualDevice: 3,
          object: 0x000200,
          gainParam: 0x0060,
          muteParam: 0x0061,
        },
        capabilities: ["setLevel", "setMute"],
        icon: "volume-2",
        displayOrder: 20,
      },
      {
        id: DEV_BSS_MAIN_R,
        connectionId: CONN_BSS,
        roomId: ROOM_HALL,
        name: "BSS Main R",
        description: "Main output bus Right — BLU-100 sál",
        type: "audio",
        subtype: "bss-soundweb.fader",
        address: {
          node: 0x1dfe,
          virtualDevice: 3,
          object: 0x000201,
          gainParam: 0x0060,
          muteParam: 0x0061,
        },
        capabilities: ["setLevel", "setMute"],
        icon: "volume-2",
        displayOrder: 21,
      },
      {
        id: DEV_BSS_AUX,
        connectionId: CONN_BSS,
        roomId: ROOM_HALL,
        name: "BSS Aux Send",
        description: "Aux send bus (monitoring / IEM) — BLU-100 sál",
        type: "audio",
        subtype: "bss-soundweb.fader",
        address: {
          node: 0x1dfe,
          virtualDevice: 3,
          object: 0x000300,
          gainParam: 0x0060,
          muteParam: 0x0061,
        },
        capabilities: ["setLevel", "setMute"],
        icon: "headphones",
        displayOrder: 30,
      },
    ])
    .onConflictDoNothing();

  // ── devices: DALI fixtures ────────────────────────────────────
  //
  // Address fields:
  //   deviceId:    The Lunatone IoT gateway's internal identifying number
  //                (assigned during a bus scan, visible in GET /devices response).
  //                NOT the DALI short address.
  //   daliAddress: Raw DALI short address 0..63 (metadata only, for reference).
  //
  // These are PLACEHOLDER values. Run a bus scan via the gateway's web interface
  // (or POST /dali/scan + GET /dali/scan) to discover real device IDs, then update.
  await db
    .insert(devices)
    .values([
      {
        id: DEV_DALI_SPOT1,
        connectionId: CONN_DALI,
        roomId: ROOM_HALL,
        name: "DALI Spot 1",
        description: "Ceiling spot 1 — sál (DALI addr 0)",
        type: "light",
        subtype: "dali.fixture",
        address: { deviceId: 1, daliAddress: 0 },
        capabilities: ["on", "off", "setBrightness", "recall"],
        icon: "lightbulb",
        displayOrder: 40,
      },
      {
        id: DEV_DALI_SPOT2,
        connectionId: CONN_DALI,
        roomId: ROOM_HALL,
        name: "DALI Spot 2",
        description: "Ceiling spot 2 — sál (DALI addr 1)",
        type: "light",
        subtype: "dali.fixture",
        address: { deviceId: 2, daliAddress: 1 },
        capabilities: ["on", "off", "setBrightness", "recall"],
        icon: "lightbulb",
        displayOrder: 41,
      },
      {
        id: DEV_DALI_WASH1,
        connectionId: CONN_DALI,
        roomId: ROOM_HALL,
        name: "DALI Wash 1",
        description: "Wall wash 1 — sál (DALI addr 8)",
        type: "light",
        subtype: "dali.fixture",
        address: { deviceId: 9, daliAddress: 8 },
        capabilities: ["on", "off", "setBrightness", "recall"],
        icon: "sun",
        displayOrder: 42,
      },
      {
        id: DEV_DALI_WASH2,
        connectionId: CONN_DALI,
        roomId: ROOM_HALL,
        name: "DALI Wash 2",
        description: "Wall wash 2 — sál (DALI addr 9)",
        type: "light",
        subtype: "dali.fixture",
        address: { deviceId: 10, daliAddress: 9 },
        capabilities: ["on", "off", "setBrightness", "recall"],
        icon: "sun",
        displayOrder: 43,
      },
      {
        id: DEV_DALI_AMBIENT,
        connectionId: CONN_DALI,
        roomId: ROOM_FOYER,
        name: "DALI Ambient Strip",
        description: "Ambient LED strip — foyer (DALI addr 16)",
        type: "light",
        subtype: "dali.fixture",
        address: { deviceId: 17, daliAddress: 16 },
        capabilities: ["on", "off", "setBrightness", "recall"],
        icon: "zap",
        displayOrder: 44,
      },
    ])
    .onConflictDoNothing();

  // ── connection: NETIO PowerBOX ───────────────────────────────
  await db
    .insert(connections)
    .values({
      id: CONN_NETIO,
      name: "NETIO PowerBOX 4Kx (sál)",
      driverId: "netio",
      // ↓ Change to your NETIO device's IP.
      host: "192.168.1.102",
      port: 80,
      protocol: "tcp",
      config: {
        // Default factory credentials — change after first login.
        username: "netio",
        password: "netio",
        responseTimeoutMs: 3000,
      },
    })
    .onConflictDoNothing();

  // ── devices: NETIO sockets ────────────────────────────────────
  //
  // Each socket maps to one physical outlet on the NETIO box (1-based).
  // Typical uses in a gallery: projector power, screen motor, haze machine, etc.
  await db
    .insert(devices)
    .values([
      {
        id: DEV_NETIO_SOCK1,
        connectionId: CONN_NETIO,
        roomId: ROOM_HALL,
        name: "Napájení projektoru",
        description: "Mains supply for the Barco projector — NETIO output 1",
        type: "power",
        subtype: "netio.socket",
        address: { outputId: 1 },
        capabilities: ["on", "off", "shortOff"],
        icon: "plug",
        displayOrder: 50,
      },
      {
        id: DEV_NETIO_SOCK2,
        connectionId: CONN_NETIO,
        roomId: ROOM_HALL,
        name: "Napájení zesilovače",
        description: "Mains supply for the audio amplifier — NETIO output 2",
        type: "power",
        subtype: "netio.socket",
        address: { outputId: 2 },
        capabilities: ["on", "off"],
        icon: "plug",
        displayOrder: 51,
      },
      {
        id: DEV_NETIO_SOCK3,
        connectionId: CONN_NETIO,
        roomId: ROOM_HALL,
        name: "Hazer",
        description: "Haze machine — NETIO output 3 (shortOn for a timed burst)",
        type: "power",
        subtype: "netio.socket",
        address: { outputId: 3 },
        capabilities: ["on", "off", "shortOn"],
        icon: "wind",
        displayOrder: 52,
      },
      {
        id: DEV_NETIO_SOCK4,
        connectionId: CONN_NETIO,
        roomId: ROOM_FOYER,
        name: "Foyer displej",
        description: "Display screen power in the foyer — NETIO output 4",
        type: "power",
        subtype: "netio.socket",
        address: { outputId: 4 },
        capabilities: ["on", "off"],
        icon: "monitor",
        displayOrder: 53,
      },
    ])
    .onConflictDoNothing();

  log.info("Seed complete", {
    rooms: 2,
    connections: 5,
    devices: 16,
    note: "Update IP addresses and BSS/DALI placeholder IDs to match your hardware",
  });
  await closeDb();
}

await main();
