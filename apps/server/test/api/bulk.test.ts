/**
 * Bulk device routes tests — hermetic (no DB / Redis / subprocesses).
 *
 * Mounts the real route map on an ephemeral Bun.serve with in-memory repos and
 * a fake DeviceManager. Manifest validation is *not* faked: the routes call the
 * real `driverRegistry` singleton (a static import of the installed drivers),
 * so a Samsung MDC row here is checked against the shipped manifest exactly as
 * it would be in production.
 *
 * The focus is the contract that makes a 64-row import safe to press once:
 * validate everything first, write all of it or none of it, and address every
 * failure to a row + field so the grid can highlight the cell.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import type {
  BulkApplyResult,
  BulkConnectionApplyResult,
  BulkConnectionDeleteResult,
  BulkDeleteResult,
} from "@gallery/types";
import { bulkRoutes } from "../../src/api/routes/bulk.ts";
import type { ApiContext } from "../../src/api/context.ts";
import type { BulkWriteRow } from "../../src/db/repositories.ts";

type Row = Record<string, unknown>;

let connectionRows: Record<string, Row>;
let deviceRows: Record<string, Row>;
let roomRows: Row[];
/** Device ids a scene action references (delete must refuse these). */
let sceneReferencedIds: string[];
/** DeviceManager calls, in order — asserts the driver runtime is reconciled. */
let managerCalls: string[];
let nextId: number;

const newId = (prefix: string): string => `${prefix}${nextId++}`;

const fakeConnections = {
  async get(id: string) {
    return connectionRows[id];
  },
  async list() {
    return Object.values(connectionRows);
  },
};

const fakeDevices = {
  async get(id: string) {
    return deviceRows[id];
  },
  async list() {
    return Object.values(deviceRows);
  },
};

const fakeRooms = {
  async list() {
    return roomRows;
  },
};

/**
 * Stands in for `bulkRepo`, whose real implementation is one Drizzle
 * transaction (covered by the DB-backed integration suite). The semantics it
 * reproduces are the ones the route depends on: a row's inline connection is
 * written first so the device can be attached to it.
 */
const fakeBulk = {
  async apply(rows: BulkWriteRow[]) {
    return rows.map((row) => {
      let connectionId = row.device.connectionId;
      let connectionAction: "created" | "updated" | "unchanged" = "unchanged";
      if (row.connection) {
        if (row.connection.id) {
          connectionRows[row.connection.id] = { ...connectionRows[row.connection.id], ...row.connection.values };
          connectionId = row.connection.id;
          connectionAction = "updated";
        } else {
          connectionId = newId("c");
          connectionRows[connectionId] = { id: connectionId, ...row.connection.values };
          connectionAction = "created";
        }
      }
      if (row.device.id) {
        deviceRows[row.device.id] = { ...deviceRows[row.device.id], ...row.device.values };
        return {
          connectionId: deviceRows[row.device.id]!.connectionId as string,
          deviceId: row.device.id,
          connectionAction,
          deviceAction: "updated" as const,
        };
      }
      const deviceId = newId("d");
      deviceRows[deviceId] = { id: deviceId, connectionId, ...row.device.values };
      return { connectionId: connectionId as string, deviceId, connectionAction, deviceAction: "created" as const };
    });
  },

  async applyConnections(rows: { id?: string; values: Record<string, unknown> }[]) {
    return rows.map((row) => {
      if (row.id) {
        connectionRows[row.id] = { ...connectionRows[row.id], ...row.values };
        return { connectionId: row.id, action: "updated" as const };
      }
      const connectionId = newId("c");
      connectionRows[connectionId] = { id: connectionId, ...row.values };
      return { connectionId, action: "created" as const };
    });
  },

  async connectionsWithDevices(connectionIds: string[]) {
    return connectionIds.filter((id) => Object.values(deviceRows).some((d) => d.connectionId === id));
  },

  async deleteConnections(connectionIds: string[]) {
    for (const id of connectionIds) delete connectionRows[id];
    return connectionIds.length;
  },

  async sceneReferenced(deviceIds: string[]) {
    return deviceIds.filter((id) => sceneReferencedIds.includes(id));
  },

  async deleteDevices(deviceIds: string[], deleteOrphanedConnections: boolean) {
    const affected = new Set<string>();
    for (const id of deviceIds) {
      affected.add(deviceRows[id]?.connectionId as string);
      delete deviceRows[id];
    }
    const deletedConnections: string[] = [];
    const touchedConnections: string[] = [];
    for (const connectionId of affected) {
      const remaining = Object.values(deviceRows).filter((d) => d.connectionId === connectionId);
      if (deleteOrphanedConnections && !remaining.length) {
        delete connectionRows[connectionId];
        deletedConnections.push(connectionId);
      } else {
        touchedConnections.push(connectionId);
      }
    }
    return { deletedDevices: deviceIds.length, deletedConnections, touchedConnections };
  },
};

const fakeDeviceManager = {
  async addConnection(connection: { id: string }) {
    managerCalls.push(`add:${connection.id}`);
  },
  async stopConnection(id: string) {
    managerCalls.push(`stop:${id}`);
  },
  async refreshConnectionDevices(id: string) {
    managerCalls.push(`refresh:${id}`);
  },
};

// The real registry (static import of the installed drivers) — manifests are
// validated for real, so these tests break if a manifest schema drifts.
const { driverRegistry } = await import("../../src/core/DriverRegistry.ts");

const ctx = {
  connections: fakeConnections,
  devices: fakeDevices,
  rooms: fakeRooms,
  bulk: fakeBulk,
  deviceManager: fakeDeviceManager,
  driverRegistry,
} as unknown as ApiContext;

let server: Server<unknown>;
let base: string;

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

/** One 1:1 Samsung display row: the connection and the endpoint in one go. */
function displayRow(name: string, host: string): Record<string, unknown> {
  return {
    name,
    type: "display",
    connection: { name, driverId: "samsung-mdc", host, port: 1515 },
  };
}

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { ...bulkRoutes(ctx) } });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

beforeEach(() => {
  nextId = 1;
  connectionRows = {};
  deviceRows = {};
  roomRows = [{ id: "r1", name: "Hall" }];
  sceneReferencedIds = [];
  managerCalls = [];
});

describe("POST /bulk/devices — creating 1:1 rows", () => {
  test("writes a connection and a device per row, and starts each driver host", async () => {
    const { status, body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [displayRow("Display 01", "10.0.1.1"), displayRow("Display 02", "10.0.1.2")],
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.created).toBe(2);
    expect(body.updated).toBe(0);
    expect(Object.keys(connectionRows)).toHaveLength(2);
    expect(Object.keys(deviceRows)).toHaveLength(2);
    expect(body.rows.every((r) => r.device === "created" && r.connection === "created")).toBe(true);
    // Each new connection is started; none needs a separate cache refresh
    // (starting one re-reads its devices).
    expect(managerCalls.filter((c) => c.startsWith("add:"))).toHaveLength(2);
    expect(managerCalls.some((c) => c.startsWith("refresh:"))).toBe(false);
  });

  test("fills endpoint type, address defaults and capabilities from the manifest", async () => {
    await post<BulkApplyResult>("/api/v1/bulk/devices", { rows: [displayRow("Display 01", "10.0.1.1")] });

    const device = Object.values(deviceRows)[0]!;
    // The sheet never carries these: `soloEndpointType` names the endpoint,
    // `displayId` defaults to 1, capabilities project the endpoint's commands.
    expect(device.subtype).toBe("samsung-mdc.display");
    expect(device.address).toEqual({ displayId: 1 });
    expect(device.capabilities).toEqual(["on", "off"]);
  });

  test("an explicit address wins over the manifest default", async () => {
    await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ ...displayRow("Chain 2", "10.0.1.9"), address: { displayId: 2 } }],
    });

    expect(Object.values(deviceRows)[0]!.address).toEqual({ displayId: 2 });
  });
});

describe("POST /bulk/devices — validation is all-or-nothing", () => {
  test("one bad host rejects the batch and writes nothing", async () => {
    const { status, body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [displayRow("Display 01", "10.0.1.1"), displayRow("Display 02", "10.0.1.999")],
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.created).toBe(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ row: 1, field: "connection.host" });
    // The *good* row is not written either — that's the point of the endpoint.
    expect(Object.keys(deviceRows)).toHaveLength(0);
    expect(Object.keys(connectionRows)).toHaveLength(0);
    expect(managerCalls).toEqual([]);
  });

  test("an out-of-range address is addressed to its own cell", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ ...displayRow("Display 01", "10.0.1.1"), address: { displayId: 999 } }],
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ row: 0, field: "address.displayId" });
  });

  test("a missing room is rejected before anything is written", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ ...displayRow("Display 01", "10.0.1.1"), roomId: "nope" }],
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ row: 0, field: "roomId", message: "room not found" });
    expect(Object.keys(deviceRows)).toHaveLength(0);
  });

  test("every failing row is reported, not just the first", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [
        displayRow("Display 01", "10.0.1.1"),
        { ...displayRow("Display 02", "10.0.1.2"), roomId: "nope" },
        { ...displayRow("Display 03", "10.0.1.3"), address: { displayId: 0 } },
      ],
    });

    expect(body.ok).toBe(false);
    expect(body.errors.map((e) => e.row)).toEqual([1, 2]);
  });

  test("a row without a connection is rejected", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ name: "Orphan", type: "display" }],
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]!.message).toContain("must name a connection");
  });

  test("an empty or oversized batch is a 400, not a row-level rejection", async () => {
    expect((await post("/api/v1/bulk/devices", { rows: [] })).status).toBe(400);
    expect((await post("/api/v1/bulk/devices", { rows: "nope" })).status).toBe(400);
  });
});

describe("POST /bulk/devices — dry run", () => {
  test("reports what would happen and writes nothing", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [displayRow("Display 01", "10.0.1.1"), displayRow("Display 02", "10.0.1.2")],
      dryRun: true,
    });

    expect(body).toMatchObject({ ok: true, dryRun: true, created: 2, updated: 0 });
    expect(Object.keys(deviceRows)).toHaveLength(0);
    expect(managerCalls).toEqual([]);
  });

  test("still reports the errors a real apply would fail on", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [displayRow("Display 01", "nope..1")],
      dryRun: true,
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ row: 0, field: "connection.host" });
  });
});

describe("POST /bulk/devices — patching existing devices", () => {
  beforeEach(() => {
    connectionRows.c9 = { id: "c9", name: "Wall", driverId: "samsung-mdc", host: "10.0.1.1", port: 1515, enabled: true };
    deviceRows.d1 = { id: "d1", connectionId: "c9", name: "Display 01", type: "display", subtype: "samsung-mdc.display", address: { displayId: 1 }, roomId: null };
    deviceRows.d2 = { id: "d2", connectionId: "c9", name: "Display 02", type: "display", subtype: "samsung-mdc.display", address: { displayId: 2 }, roomId: null };
  });

  test("assigns a room to several rows without touching anything else", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [
        { deviceId: "d1", roomId: "r1" },
        { deviceId: "d2", roomId: "r1" },
      ],
    });

    expect(body).toMatchObject({ ok: true, created: 0, updated: 2 });
    expect(deviceRows.d1).toMatchObject({ roomId: "r1", name: "Display 01", address: { displayId: 1 } });
    expect(deviceRows.d2!.roomId).toBe("r1");
    // No connection field changed, so the host isn't restarted — just refreshed.
    expect(managerCalls).toEqual(["refresh:c9"]);
  });

  test("restarts the driver host when a row edits its connection", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ deviceId: "d1", connection: { id: "c9", host: "10.0.9.9" } }],
    });

    expect(body.ok).toBe(true);
    expect(connectionRows.c9!.host).toBe("10.0.9.9");
    expect(managerCalls).toEqual(["stop:c9", "add:c9"]);
  });

  test("rejects an unknown device id", async () => {
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ deviceId: "ghost", roomId: "r1" }],
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ row: 0, field: "deviceId", message: "device not found" });
  });

  test("refuses to move a device to another connection", async () => {
    connectionRows.c8 = { id: "c8", name: "Other", driverId: "samsung-mdc", host: "10.0.2.1", enabled: true };
    const { body } = await post<BulkApplyResult>("/api/v1/bulk/devices", {
      rows: [{ deviceId: "d1", connectionId: "c8" }],
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]!.message).toContain("can't be moved");
  });
});

describe("POST /bulk/devices/delete", () => {
  beforeEach(() => {
    connectionRows.c1 = { id: "c1", name: "Display 01", driverId: "samsung-mdc", host: "10.0.1.1" };
    connectionRows.c2 = { id: "c2", name: "Wall", driverId: "samsung-mdc", host: "10.0.1.2" };
    deviceRows.d1 = { id: "d1", connectionId: "c1", name: "Display 01" };
    deviceRows.d2 = { id: "d2", connectionId: "c2", name: "Wall A" };
    deviceRows.d3 = { id: "d3", connectionId: "c2", name: "Wall B" };
  });

  test("takes the connection with the device when it is left empty", async () => {
    const { body } = await post<BulkDeleteResult>("/api/v1/bulk/devices/delete", {
      deviceIds: ["d1", "d2"],
      deleteOrphanedConnections: true,
    });

    expect(body).toMatchObject({ ok: true, deletedDevices: 2, deletedConnections: 1 });
    // c1 lost its only endpoint and went with it; c2 still has d3.
    expect(connectionRows.c1).toBeUndefined();
    expect(connectionRows.c2).toBeDefined();
    expect(managerCalls).toEqual(["stop:c1", "refresh:c2"]);
  });

  test("keeps connections when not asked to clean them up", async () => {
    const { body } = await post<BulkDeleteResult>("/api/v1/bulk/devices/delete", { deviceIds: ["d1"] });

    expect(body).toMatchObject({ ok: true, deletedDevices: 1, deletedConnections: 0 });
    expect(connectionRows.c1).toBeDefined();
  });

  test("refuses the whole batch when a device is still used by a scene", async () => {
    sceneReferencedIds = ["d2"];
    const { body } = await post<BulkDeleteResult>("/api/v1/bulk/devices/delete", { deviceIds: ["d1", "d2"] });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ deviceId: "d2" });
    expect(deviceRows.d1).toBeDefined();
    expect(deviceRows.d2).toBeDefined();
  });

  test("rejects unknown device ids", async () => {
    const { body } = await post<BulkDeleteResult>("/api/v1/bulk/devices/delete", { deviceIds: ["ghost"] });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ deviceId: "ghost", message: "device not found" });
  });
});

describe("POST /bulk/connections", () => {
  test("creates a batch of plain connections — the twenty-NETIOs case", async () => {
    const { status, body } = await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [
        { name: "Hall 1 — Netio 1", driverId: "netio", host: "10.0.3.1" },
        { name: "Hall 1 — Netio 2", driverId: "netio", host: "10.0.3.2" },
        { name: "Hall 1 — Netio 3", driverId: "netio", host: "10.0.3.3" },
      ],
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, created: 3, updated: 0 });
    expect(Object.keys(connectionRows)).toHaveLength(3);
    // No endpoint had to be decided first — that is the whole point of the sheet.
    expect(Object.keys(deviceRows)).toHaveLength(0);
    expect(managerCalls.filter((c) => c.startsWith("add:"))).toHaveLength(3);
  });

  test("fills driver config from the manifest defaults, so the sheet needs no config columns", async () => {
    await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [{ name: "Wall 1", driverId: "samsung-mdc", host: "10.0.4.1" }],
    });

    const created = Object.values(connectionRows)[0]!;
    expect(created.config).toMatchObject({ responseTimeoutMs: 2000, reconnectMs: 2000 });
    expect(created).toMatchObject({ host: "10.0.4.1", protocol: "tcp", enabled: true });
  });

  test("rejects the whole batch for one bad row, addressed to a bare column key", async () => {
    const { body } = await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [
        { name: "Good", driverId: "netio", host: "10.0.3.1" },
        { name: "Bad", driverId: "netio", host: "10.0.3.999" },
      ],
    });

    expect(body.ok).toBe(false);
    // A connection sheet has no second record, so no `connection.` prefix.
    expect(body.errors[0]).toMatchObject({ row: 1, field: "host" });
    expect(Object.keys(connectionRows)).toHaveLength(0);
  });

  test("requires a driver and a name when creating", async () => {
    const missingDriver = await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [{ name: "Nameless", host: "10.0.3.1" }],
    });
    expect(missingDriver.body.errors[0]).toMatchObject({ row: 0, field: "driverId" });

    const missingName = await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [{ driverId: "netio", host: "10.0.3.1" }],
    });
    expect(missingName.body.errors[0]).toMatchObject({ row: 0, field: "name" });
  });

  test("updates in place and restarts the driver host", async () => {
    connectionRows.c9 = { id: "c9", name: "Old", driverId: "netio", host: "10.0.3.1", enabled: true };
    const { body } = await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [{ connectionId: "c9", name: "New", host: "10.0.3.9" }],
    });

    expect(body).toMatchObject({ ok: true, created: 0, updated: 1 });
    expect(connectionRows.c9).toMatchObject({ name: "New", host: "10.0.3.9" });
    expect(managerCalls).toEqual(["stop:c9", "add:c9"]);
  });

  test("a dry run reports the batch without writing it", async () => {
    const { body } = await post<BulkConnectionApplyResult>("/api/v1/bulk/connections", {
      rows: [{ name: "Netio 1", driverId: "netio", host: "10.0.3.1" }],
      dryRun: true,
    });

    expect(body).toMatchObject({ ok: true, dryRun: true, created: 1 });
    expect(Object.keys(connectionRows)).toHaveLength(0);
    expect(managerCalls).toEqual([]);
  });
});

describe("POST /bulk/connections/delete", () => {
  beforeEach(() => {
    connectionRows.c1 = { id: "c1", name: "Empty", driverId: "netio", host: "10.0.3.1" };
    connectionRows.c2 = { id: "c2", name: "In use", driverId: "netio", host: "10.0.3.2" };
    deviceRows.d1 = { id: "d1", connectionId: "c2", name: "Socket 1" };
  });

  test("deletes connections nothing hangs off, and stops their hosts", async () => {
    const { body } = await post<BulkConnectionDeleteResult>("/api/v1/bulk/connections/delete", {
      connectionIds: ["c1"],
    });

    expect(body).toMatchObject({ ok: true, deletedConnections: 1 });
    expect(connectionRows.c1).toBeUndefined();
    expect(managerCalls).toEqual(["stop:c1"]);
  });

  test("refuses the batch when a connection still carries devices", async () => {
    const { body } = await post<BulkConnectionDeleteResult>("/api/v1/bulk/connections/delete", {
      connectionIds: ["c1", "c2"],
    });

    expect(body.ok).toBe(false);
    expect(body.errors[0]).toMatchObject({ connectionId: "c2" });
    // Nothing deleted — not even the one that was fine.
    expect(connectionRows.c1).toBeDefined();
  });
});
