/**
 * Seed script — inserts sample data so the core can start drivers without an
 * admin UI. Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.
 *
 * Run with `bun run seed` (from apps/server) or `bun src/db/seed.ts`.
 *
 * NOTE: the sample hosts are placeholders. Point them at real (or mock) devices
 * to actually control hardware.
 */

import { logger } from "../logger.ts";
import { closeDb, db } from "./client.ts";
import { connections, devices, rooms } from "./schema.ts";

const log = logger.child("seed");

// Fixed ids keep the seed idempotent.
const ROOM_HALL = "11111111-1111-1111-1111-111111111111";
const CONN_PJLINK = "22222222-2222-2222-2222-222222222222";
const CONN_TCP = "33333333-3333-3333-3333-333333333333";
const DEV_PROJECTOR = "44444444-4444-4444-4444-444444444444";
const DEV_CURTAIN = "55555555-5555-5555-5555-555555555555";

async function main(): Promise<void> {
  await db
    .insert(rooms)
    .values({
      id: ROOM_HALL,
      name: "Hlavní sál",
      description: "Main hall",
      icon: "building",
      color: "#3B82F6",
      displayOrder: 0,
    })
    .onConflictDoNothing();

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
    ])
    .onConflictDoNothing();

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
      },
    ])
    .onConflictDoNothing();

  log.info("Seed complete", { rooms: 1, connections: 2, devices: 2 });
  await closeDb();
}

await main();
