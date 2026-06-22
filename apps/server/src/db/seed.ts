/**
 * Seed script — inserts sample data so the core can start drivers without an
 * admin UI. Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
 *
 * Run with `bun run seed` (from apps/server) or `bun src/db/seed.ts`.
 *
 * The sample rows are defined as exported `SEED_*` consts (not inlined in the
 * inserter) so a hermetic test can validate every connection config / device
 * address / scene-action param against its driver manifest — keeping the seed in
 * lock-step with the schemas. `main()` only runs when executed directly.
 *
 * NOTE: host addresses are placeholders — swap them for your real device IPs.
 *   BSS:  TCP 1023, node address comes from Audio Architect → Venue Explorer.
 *   DALI: HTTP port 80, deviceId from the Lunatone IoT gateway's device scan.
 */

import { connections, devices, iframes, rooms, sceneActions, scenes } from "@gallery/types/schema";
import { logger } from "../logger.ts";
import { closeDb, db } from "./client.ts";

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
const CONN_DALI_FOX   = "22222222-2222-2222-2222-222222222277"; // Foxtron DALI gateway
const CONN_EXTRON     = "22222222-2222-2222-2222-222222222288"; // Extron DTP CrossPoint 108 4K

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
const DEV_DALI_FOX1     = "55555555-5555-5555-5555-555555555706"; // Foxtron — individual DALI addr 1
const DEV_DALI_FOX_GRP  = "55555555-5555-5555-5555-555555555707"; // Foxtron — DALI group 0
const DEV_DALI_FOX_ALL  = "55555555-5555-5555-5555-555555555708"; // Foxtron — broadcast (all fixtures)
// NETIO sockets (outputId = outlet number on the PowerBOX, 1-based)
const DEV_NETIO_SOCK1   = "55555555-5555-5555-5555-555555555801"; // Socket 1
const DEV_NETIO_SOCK2   = "55555555-5555-5555-5555-555555555802"; // Socket 2
const DEV_NETIO_SOCK3   = "55555555-5555-5555-5555-555555555803"; // Socket 3
const DEV_NETIO_SOCK4   = "55555555-5555-5555-5555-555555555804"; // Socket 4
// Extron matrix outputs (one device per output; address = { output })
const DEV_EXTRON_OUT = (n: number): string => `55555555-5555-5555-5555-5555555559${String(n).padStart(2, "0")}`;

// Scenes
const SCENE_LIGHTS_ON    = "77777777-7777-7777-7777-777777777701";
const SCENE_MIC_ON       = "77777777-7777-7777-7777-777777777702";
const SCENE_PROJECTOR_ON = "77777777-7777-7777-7777-777777777703";
const SCENE_LECTURE_START = "77777777-7777-7777-7777-777777777704";

// Scene action IDs
const ACT_LIGHTS_SPOT1   = "88888888-8888-8888-8888-888888888801";
const ACT_LIGHTS_SPOT2   = "88888888-8888-8888-8888-888888888802";
const ACT_LIGHTS_WASH1   = "88888888-8888-8888-8888-888888888803";
const ACT_MIC_UNMUTE     = "88888888-8888-8888-8888-888888888804";
const ACT_MIC_LEVEL      = "88888888-8888-8888-8888-888888888805";
const ACT_PROJ_ON        = "88888888-8888-8888-8888-888888888806";
const ACT_LECTURE_LIGHTS = "88888888-8888-8888-8888-888888888807";
const ACT_LECTURE_MIC    = "88888888-8888-8888-8888-888888888808";
const ACT_LECTURE_PROJ   = "88888888-8888-8888-8888-888888888809";

// ── seed data (exported so a conformance test can validate it) ───────────────

const SEED_ROOMS = [
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
];

export const SEED_CONNECTIONS = [
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
  {
    id: CONN_DALI_FOX,
    name: "Foxtron DALI-2 IoT (sál)",
    driverId: "dali-foxtron",
    // ↓ Change to your Foxtron gateway's IP. REST API on port 80.
    host: "10.54.17.90",
    port: 24,
    protocol: "tcp",
    // Foxtron has no discovery/scan — only the response timeout is configurable.
    config: {
      responseTimeoutMs: 4000,
    },
  },
  {
    id: CONN_EXTRON,
    name: "Extron DTP CrossPoint 108 (sál)",
    driverId: "extron-matrix",
    // ↓ Change to your switcher's IP. SIS control over Telnet, port 23.
    host: "192.168.1.103",
    port: 23,
    protocol: "tcp",
    config: {
      // DTP CrossPoint 108 4K: 10 inputs × 8 outputs. Add `password` if the
      // switcher has a control password set.
      inputCount: 10,
      outputCount: 8,
      responseTimeoutMs: 2000,
      reconnectMs: 2000,
    },
  },
  {
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
  },
];

// 8 outputs of the Extron DTP CrossPoint 108 4K, generated so the input labels
// live in one place. Each output is a device feeding a destination in the venue.
const EXTRON_INPUT_LABELS = [
  "Lectern PC", "Laptop HDMI", "Doc Camera", "Blu-ray", "Media Server",
  "Camera 1", "Camera 2", "Wireless AirMedia", "Aux HDMI", "Test Pattern",
];
const EXTRON_OUTPUT_NAMES: { name: string; roomId: string; icon: string }[] = [
  { name: "Projektor sál",      roomId: ROOM_HALL,  icon: "projector" },
  { name: "LED stěna sál",      roomId: ROOM_HALL,  icon: "monitor" },
  { name: "Náhled sál",         roomId: ROOM_HALL,  icon: "monitor" },
  { name: "Lobby displej",      roomId: ROOM_FOYER, icon: "monitor" },
  { name: "Foyer displej 2",    roomId: ROOM_FOYER, icon: "monitor" },
  { name: "Stream enkodér",     roomId: ROOM_HALL,  icon: "radio" },
  { name: "Záznam",             roomId: ROOM_HALL,  icon: "circle" },
  { name: "Confidence monitor", roomId: ROOM_HALL,  icon: "monitor" },
];
const EXTRON_OUTPUTS = EXTRON_OUTPUT_NAMES.map((o, i) => {
  const output = i + 1;
  return {
    id: DEV_EXTRON_OUT(output),
    connectionId: CONN_EXTRON,
    roomId: o.roomId,
    name: o.name,
    description: `Extron output ${output} — selects one of the 10 matrix inputs`,
    type: "video",
    subtype: "extron-matrix.output",
    address: { output },
    capabilities: ["setInput", "setVideoInput", "setAudioInput"],
    metadata: { inputCount: EXTRON_INPUT_LABELS.length, inputs: EXTRON_INPUT_LABELS },
    icon: o.icon,
    displayOrder: 60 + i,
  };
});

export const SEED_DEVICES = [
  // ── PJLink + TCP ────────────────────────────────────────────
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

  // ── BSS faders ──────────────────────────────────────────────
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

  // ── DALI fixtures ───────────────────────────────────────────
  //
  // Address fields:
  //   deviceId:    The Lunatone IoT gateway's internal identifying number
  //                (assigned during a bus scan). NOT the DALI short address.
  //   daliAddress: Raw DALI short address 0..63 (metadata only, for reference).
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
  {
    id: DEV_DALI_FOX1,
    connectionId: CONN_DALI_FOX,
    roomId: ROOM_HALL,
    name: "Foxtron Dimmer 1",
    description: "Individual fixture — DALI short address 1",
    type: "light",
    subtype: "dali-foxtron.fixture",
    // Individual addressing (addressMode defaults to "address").
    address: { addressMode: "address", daliAddress: 1 },
    capabilities: ["on", "off", "setBrightness", "recall"],
    icon: "zap",
    displayOrder: 45,
  },
  {
    id: DEV_DALI_FOX_GRP,
    connectionId: CONN_DALI_FOX,
    roomId: ROOM_HALL,
    name: "Foxtron Skupina 0",
    description: "DALI group 0 — controls every fixture configured into group 0",
    type: "light",
    subtype: "dali-foxtron.fixture",
    // Group addressing.
    address: { addressMode: "group", group: 0 },
    capabilities: ["on", "off", "setBrightness", "recall"],
    icon: "layers",
    displayOrder: 46,
  },
  {
    id: DEV_DALI_FOX_ALL,
    connectionId: CONN_DALI_FOX,
    roomId: ROOM_HALL,
    name: "Foxtron Vše",
    description: "Broadcast — every fixture on the DALI bus at once",
    type: "light",
    subtype: "dali-foxtron.fixture",
    // Broadcast addressing (no daliAddress/group needed).
    address: { addressMode: "broadcast" },
    capabilities: ["on", "off", "setBrightness", "recall"],
    icon: "sun",
    displayOrder: 47,
  },

  // ── NETIO sockets ───────────────────────────────────────────
  // Each socket maps to one physical outlet on the NETIO box (1-based).
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

  // ── Extron matrix outputs ───────────────────────────────────
  // One device per output of the DTP CrossPoint 108 4K. Each picks one of the
  // 10 inputs. `metadata.inputs` gives the User UI human input labels (index 0 =
  // input 1); the widget falls back to "Input N" up to metadata.inputCount.
  ...EXTRON_OUTPUTS,
];

const SEED_SCENES = [
  {
    id: SCENE_LIGHTS_ON,
    roomId: ROOM_HALL,
    name: "Světla zapnout",
    description: "Turns on the main spots and wash lights at lecture brightness",
    icon: "lightbulb",
    color: "#F59E0B",
    isFavorite: true,
    tags: ["lights", "hall"],
  },
  {
    id: SCENE_MIC_ON,
    roomId: ROOM_HALL,
    name: "Mikrofon zapnout",
    description: "Unmutes microphone 1 and sets a comfortable gain level",
    icon: "microphone",
    color: "#8B5CF6",
    isFavorite: false,
    tags: ["audio", "hall"],
  },
  {
    id: SCENE_PROJECTOR_ON,
    roomId: ROOM_HALL,
    name: "Projektor zapnout",
    description: "Sends power-on to the Barco projector via PJLink",
    icon: "projector",
    color: "#3B82F6",
    isFavorite: true,
    tags: ["video", "hall"],
  },
  {
    id: SCENE_LECTURE_START,
    roomId: ROOM_HALL,
    name: "Přednáška — spustit",
    description: "All-in-one lecture start: lights → microphone → projector",
    icon: "play-circle",
    color: "#10B981",
    isFavorite: true,
    tags: ["lecture", "hall", "composite"],
  },
];

export const SEED_SCENE_ACTIONS = [
  // SCENE_LIGHTS_ON — parallel: all three fixtures at once
  {
    id: ACT_LIGHTS_SPOT1,
    sceneId: SCENE_LIGHTS_ON,
    deviceId: DEV_DALI_SPOT1,
    stepOrder: 0,
    parallelGroup: 0,
    command: "setBrightness",
    params: { level: 0.8 },
  },
  {
    id: ACT_LIGHTS_SPOT2,
    sceneId: SCENE_LIGHTS_ON,
    deviceId: DEV_DALI_SPOT2,
    stepOrder: 0,
    parallelGroup: 0,
    command: "setBrightness",
    params: { level: 0.8 },
  },
  {
    id: ACT_LIGHTS_WASH1,
    sceneId: SCENE_LIGHTS_ON,
    deviceId: DEV_DALI_WASH1,
    stepOrder: 0,
    parallelGroup: 0,
    command: "setBrightness",
    params: { level: 0.5 },
  },

  // SCENE_MIC_ON — unmute then set level sequentially
  {
    id: ACT_MIC_UNMUTE,
    sceneId: SCENE_MIC_ON,
    deviceId: DEV_BSS_MIC1,
    stepOrder: 0,
    parallelGroup: 0,
    command: "setMute",
    params: { muted: false },
  },
  {
    id: ACT_MIC_LEVEL,
    sceneId: SCENE_MIC_ON,
    deviceId: DEV_BSS_MIC1,
    stepOrder: 1,
    parallelGroup: 1,
    delayMs: 200,
    command: "setLevel",
    params: { level: 0.7 },
  },

  // SCENE_PROJECTOR_ON — single power-on command
  {
    id: ACT_PROJ_ON,
    sceneId: SCENE_PROJECTOR_ON,
    deviceId: DEV_PROJECTOR,
    stepOrder: 0,
    parallelGroup: 0,
    command: "on",
    params: {},
  },

  // SCENE_LECTURE_START — sub-scenes in sequence: lights → mic → projector
  {
    id: ACT_LECTURE_LIGHTS,
    sceneId: SCENE_LECTURE_START,
    childSceneId: SCENE_LIGHTS_ON,
    stepOrder: 0,
    parallelGroup: 0,
  },
  {
    id: ACT_LECTURE_MIC,
    sceneId: SCENE_LECTURE_START,
    childSceneId: SCENE_MIC_ON,
    stepOrder: 1,
    parallelGroup: 1,
  },
  {
    id: ACT_LECTURE_PROJ,
    sceneId: SCENE_LECTURE_START,
    childSceneId: SCENE_PROJECTOR_ON,
    stepOrder: 2,
    parallelGroup: 2,
  },
];

const SEED_IFRAMES = [
  {
    id: "66666666-6666-6666-6666-666666666601",
    name: "Pixera",
    url: "http://10.54.17.99:1338/static/ui_builder/ui_builder.html?device=planetapraha",
    displayOrder: 0,
  },
];

// ── inserter ─────────────────────────────────────────────────
/**
 * Populates the database with sample data for rooms, connections, devices, scenes, scene actions, and iframes.
 *
 * Records are inserted idempotently; calling this function multiple times does not create duplicates.
 * Closes the database connection when complete.
 */

async function main(): Promise<void> {
  await db.insert(rooms).values(SEED_ROOMS).onConflictDoNothing();
  await db.insert(connections).values(SEED_CONNECTIONS).onConflictDoNothing();
  await db.insert(devices).values(SEED_DEVICES).onConflictDoNothing();
  await db.insert(scenes).values(SEED_SCENES).onConflictDoNothing();
  await db.insert(sceneActions).values(SEED_SCENE_ACTIONS).onConflictDoNothing();
  await db.insert(iframes).values(SEED_IFRAMES).onConflictDoNothing();

  log.info("Seed complete", {
    rooms: SEED_ROOMS.length,
    connections: SEED_CONNECTIONS.length,
    devices: SEED_DEVICES.length,
    scenes: SEED_SCENES.length,
    sceneActions: SEED_SCENE_ACTIONS.length,
    iframes: SEED_IFRAMES.length,
    note: "Update IP addresses and BSS/DALI placeholder IDs to match your hardware",
  });
  await closeDb();
}

// Only run the inserter when executed directly (`bun run seed`); importing this
// module for its SEED_* data (e.g. in tests) must not touch the database.
if (import.meta.main) await main();
