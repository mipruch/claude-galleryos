/**
 * Bulk device routes — the write side of the admin spreadsheet editor.
 *
 *   POST  /api/v1/bulk/devices          { rows, dryRun? }  → BulkApplyResult
 *   POST  /api/v1/bulk/devices/delete   { deviceIds, deleteOrphanedConnections? }
 *
 * One request carries a whole sheet. Each row is a device plus, for the 1:1
 * drivers (`DriverManifest.soloEndpointType` — a projector, a display on its
 * own IP), the connection underneath it: the operator fills one row per
 * physical box and both records are written together.
 *
 * Two properties make this safe to point at 64 rows at once:
 *
 *  - **Validate everything, then write.** Every row is checked against the
 *    driver manifests (connection config, endpoint address), against the
 *    referenced rooms/connections/devices, and against the create/update rules
 *    the single-record routes enforce. One bad row rejects the batch and
 *    nothing is written — a half-imported rack is the failure mode this whole
 *    endpoint exists to avoid.
 *  - **Errors are addressed, not summarised.** Failures come back as
 *    `{ row, field, message }` (`field` matching the sheet's column keys, e.g.
 *    `connection.host`, `address.displayId`), so the grid paints the offending
 *    cell instead of showing one wall of text. A rejected batch is therefore a
 *    *200 with `ok: false`* — an expected, renderable outcome. Only malformed
 *    requests (bad JSON, `rows` not an array) get a 4xx.
 *
 * `dryRun` runs the identical validation pass and reports what would happen,
 * writing nothing — what the sheet's "Check" button calls before a big import.
 *
 * After a successful write the affected driver subprocesses are reconciled the
 * same way the single-record routes do it (restart a connection whose config
 * changed, refresh the device cache of one that only gained endpoints), with
 * bounded concurrency so importing 64 displays doesn't spawn 64 hosts at once.
 */

import type { DriverManifest, JsonSchema } from "@gallery/driver-core";
import type {
  BulkApplyResult,
  BulkConnectionApplyResult,
  BulkConnectionDeleteResult,
  BulkConnectionRowInput,
  BulkConnectionRowResult,
  BulkDeleteResult,
  BulkDeviceRowInput,
  BulkRowError,
  BulkRowResult,
  Connection,
  Device,
} from "@gallery/types";
import { logger } from "../../logger.ts";
import type { BulkConnectionWrite, BulkWriteRow } from "../../db/repositories.ts";
import { toConnectionRecord } from "../../db/repositories.ts";
import type { ApiContext } from "../context.ts";
import { HttpError, asObject, json, readJson, route, type RouteMap } from "../http.ts";
import { assertValidConnectionConfig, assertValidDeviceAddress, coerceConnectionConfig } from "../validation.ts";

const log = logger.child("api.bulk");

/**
 * Ceiling on rows per request. Generous next to the sheets this is built for
 * (a 64-display rack) while still bounding how much work one request can ask
 * for — the write is a single transaction and every touched connection may
 * spawn a driver subprocess.
 */
const MAX_ROWS = 500;

/** How many driver hosts to (re)start at once after a write. */
const RESTART_CONCURRENCY = 4;

/** Effective value of a partial field: `undefined` keeps the current value. */
const effective = <T>(patch: T | null | undefined, current: T | null): T | null =>
  patch === undefined ? current : patch;

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Importing a rack touches dozens of connections, and each restart spawns a
 * driver subprocess that waits on a TCP connect — all at once is a thundering
 * herd, strictly sequential is needlessly slow.
 */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

/** One Ajv error, as `validation.ts` attaches it to `HttpError.details`. */
interface AjvErrorDetail {
  instancePath?: string;
  message?: string;
  params?: { missingProperty?: string };
}

/**
 * Turn a manifest-validation throw into row-addressed cell errors.
 *
 * `assertValidConnectionConfig` / `assertValidDeviceAddress` are built to abort
 * a single-record request with a 400; here they're one row's worth of a batch,
 * so their Ajv details are unpacked into `{ row, field, message }` entries
 * keyed the way the sheet keys its columns (`connection.host`,
 * `address.displayId`).
 */
function collectValidation(
  errors: BulkRowError[],
  row: number,
  /** Column-key prefix: `""` for a connection sheet, whose columns are bare. */
  prefix: "connection" | "address" | "",
  assert: () => void,
): boolean {
  try {
    assert();
    return true;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    const details = Array.isArray(err.details) ? (err.details as AjvErrorDetail[]) : [];
    if (!details.length) {
      errors.push({ row, field: prefix || undefined, message: err.message });
      return false;
    }
    for (const detail of details) {
      const missing = detail.params?.missingProperty;
      const path = detail.instancePath?.replace(/^\//, "").replace(/\//g, ".") || missing || "";
      const qualified = prefix && path ? `${prefix}.${path}` : path || prefix;
      errors.push({
        row,
        field: qualified || undefined,
        message: missing ? "is required" : (detail.message ?? "is invalid"),
      });
    }
    return false;
  }
}

/**
 * Fill in properties the row didn't mention from a schema's declared defaults.
 *
 * This is what lets a sheet drop columns the operator never touches: a Samsung
 * display on its own IP is always `displayId: 1`, a NETIO always polls on the
 * same interval — declared once in the manifest instead of typed into twenty
 * rows. Used for both endpoint addresses and connection config.
 */
function withSchemaDefaults(schema: JsonSchema | undefined, values: Record<string, unknown>): Record<string, unknown> {
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  const filled: Record<string, unknown> = { ...values };
  for (const [key, property] of Object.entries(properties)) {
    if (filled[key] === undefined && property.default !== undefined) filled[key] = property.default;
  }
  return filled;
}

/** Record a row-level problem and return null — the "this row can't be planned" signal. */
function fail(errors: BulkRowError[], row: number, message: string, field?: string): null {
  errors.push({ row, field, message });
  return null;
}

/** Only the keys a request actually set — so a patch row never blanks a column it omitted. */
function definedOnly<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function bulkRoutes(ctx: ApiContext): RouteMap {
  /** Per-request caches: a 64-row sheet references the same rooms/connections over and over. */
  interface PlanCache {
    connections: Map<string, Connection | null>;
    devices: Map<string, Device | null>;
    roomIds: Set<string> | null;
  }

  const loadConnection = async (cache: PlanCache, id: string): Promise<Connection | null> => {
    const cached = cache.connections.get(id);
    if (cached !== undefined) return cached;
    const row = (await ctx.connections.get(id)) ?? null;
    cache.connections.set(id, row);
    return row;
  };

  const loadDevice = async (cache: PlanCache, id: string): Promise<Device | null> => {
    const cached = cache.devices.get(id);
    if (cached !== undefined) return cached;
    const row = (await ctx.devices.get(id)) ?? null;
    cache.devices.set(id, row);
    return row;
  };

  const roomExists = async (cache: PlanCache, id: string): Promise<boolean> => {
    if (!cache.roomIds) cache.roomIds = new Set((await ctx.rooms.list()).map((r) => r.id));
    return cache.roomIds.has(id);
  };

  const manifestOf = (driverId: string): DriverManifest | undefined => ctx.driverRegistry.get(driverId);

  /**
   * Where a row's device lands, and what (if anything) to write to the
   * connection under it.
   */
  interface ConnectionPlan {
    write?: BulkConnectionWrite;
    connectionId?: string;
    driverId?: string;
  }

  /**
   * Plan a connection the row carries inline — the 1:1 case, where saving a
   * display also creates or updates the socket it talks to.
   */
  async function planInlineConnection(
    index: number,
    inline: NonNullable<BulkDeviceRowInput["connection"]>,
    cache: PlanCache,
    errors: BulkRowError[],
  ): Promise<ConnectionPlan | null> {
    if (inline.id) {
      const existing = await loadConnection(cache, inline.id);
      if (!existing) return fail(errors, index, "connection not found", "connectionId");
      // A connection's driver is fixed at creation, same as the single-record form.
      const driverId = existing.driverId;
      const config = coerceConnectionConfig(driverId, inline.config ?? (existing.config as Record<string, unknown>));
      collectValidation(errors, index, "connection", () =>
        assertValidConnectionConfig(driverId, {
          ...config,
          host: effective(inline.host, existing.host) ?? undefined,
          port: effective(inline.port, existing.port) ?? undefined,
        }),
      );
      return {
        connectionId: existing.id,
        driverId,
        write: {
          id: existing.id,
          values: definedOnly({
            name: inline.name,
            host: inline.host,
            port: inline.port,
            protocol: inline.protocol,
            config: inline.config === undefined ? undefined : config,
            enabled: inline.enabled,
          }),
        },
      };
    }

    if (!inline.name) return fail(errors, index, "connection name is required", "connection.name");
    const driverId = inline.driverId;
    if (!driverId) return fail(errors, index, "driver is required", "connection.driverId");
    if (!ctx.driverRegistry.has(driverId)) {
      return fail(errors, index, `unknown driver: ${driverId}`, "connection.driverId");
    }
    const config = coerceConnectionConfig(driverId, inline.config ?? {});
    collectValidation(errors, index, "connection", () =>
      assertValidConnectionConfig(driverId, {
        ...config,
        host: inline.host ?? undefined,
        port: inline.port ?? undefined,
      }),
    );
    return {
      driverId,
      write: {
        values: {
          name: inline.name,
          driverId,
          host: inline.host ?? null,
          port: inline.port ?? null,
          protocol: inline.protocol ?? "tcp",
          config,
          enabled: inline.enabled ?? true,
        },
      },
    };
  }

  /** Resolve the connection half of a row, whichever of the three ways it names one. */
  async function planConnection(
    index: number,
    input: BulkDeviceRowInput,
    existingDevice: Device | null,
    cache: PlanCache,
    errors: BulkRowError[],
  ): Promise<ConnectionPlan | null> {
    if (input.connection && input.connectionId) {
      return fail(errors, index, "row names both an existing connection and an inline one");
    }
    if (input.connection) return planInlineConnection(index, input.connection, cache, errors);

    if (input.connectionId) {
      const existing = await loadConnection(cache, input.connectionId);
      if (!existing) return fail(errors, index, "connection not found", "connectionId");
      // Moving an endpoint between connections isn't supported here either (the
      // single-record form locks the field after creation): the address is
      // validated against the connection's driver, so a move is a delete + create.
      if (existingDevice && existingDevice.connectionId !== existing.id) {
        return fail(errors, index, "a device can't be moved to another connection", "connectionId");
      }
      return { connectionId: existing.id, driverId: existing.driverId };
    }

    if (existingDevice) {
      const existing = await loadConnection(cache, existingDevice.connectionId);
      return { connectionId: existingDevice.connectionId, driverId: existing?.driverId };
    }
    return fail(errors, index, "row must name a connection");
  }

  /**
   * Validate one row of a *connection* sheet — the flat case: a socket with a
   * name, an address, and whatever config its driver insists on. Everything
   * else the manifest can default is defaulted here rather than demanded as a
   * column, which is what keeps the sheet narrow enough to fill in one pass.
   */
  async function planConnectionRow(
    index: number,
    input: BulkConnectionRowInput,
    cache: PlanCache,
    errors: BulkRowError[],
  ): Promise<BulkConnectionWrite | null> {
    const before = errors.length;
    let existing: Connection | null = null;
    if (input.connectionId) {
      existing = await loadConnection(cache, input.connectionId);
      if (!existing) return fail(errors, index, "connection not found", "connectionId");
    }

    // The driver is fixed at creation, so an update ignores whatever the row says.
    const driverId = existing?.driverId ?? input.driverId;
    if (!driverId) return fail(errors, index, "driver is required", "driverId");
    if (!ctx.driverRegistry.has(driverId)) return fail(errors, index, `unknown driver: ${driverId}`, "driverId");
    if (!existing && !input.name) return fail(errors, index, "name is required", "name");

    const manifest = manifestOf(driverId);
    const merged = {
      ...((existing?.config as Record<string, unknown> | undefined) ?? {}),
      ...(input.config ?? {}),
    };
    const config = coerceConnectionConfig(driverId, withSchemaDefaults(manifest?.connectionSchema, merged));
    collectValidation(errors, index, "", () =>
      assertValidConnectionConfig(driverId, {
        ...config,
        host: effective(input.host, existing?.host ?? null) ?? undefined,
        port: effective(input.port, existing?.port ?? null) ?? undefined,
      }),
    );
    if (errors.length > before) return null;

    // Errors are addressed to bare column keys here (`host`, not
    // `connection.host`): a connection sheet has no second record to qualify.
    return existing
      ? {
          id: existing.id,
          values: definedOnly({
            name: input.name,
            host: input.host,
            port: input.port,
            protocol: input.protocol,
            config,
            enabled: input.enabled,
          }),
        }
      : {
          values: {
            name: input.name as string,
            driverId,
            host: input.host ?? null,
            port: input.port ?? null,
            protocol: input.protocol ?? "tcp",
            config,
            enabled: input.enabled ?? true,
          },
        };
  }

  /**
   * Validate one row and turn it into the write the repo will run, or push the
   * reasons it can't be onto `errors` and return null.
   */
  async function planRow(
    index: number,
    input: BulkDeviceRowInput,
    cache: PlanCache,
    errors: BulkRowError[],
  ): Promise<BulkWriteRow | null> {
    const before = errors.length;

    // ── which device is this row about? ──────────────────────────────────
    let existingDevice: Device | null = null;
    if (input.deviceId) {
      existingDevice = await loadDevice(cache, input.deviceId);
      if (!existingDevice) return fail(errors, index, "device not found", "deviceId");
    }
    const isCreate = !existingDevice;

    const connectionPlan = await planConnection(index, input, existingDevice, cache, errors);
    if (!connectionPlan) return null;
    const { write: connectionWrite, connectionId, driverId } = connectionPlan;

    // ── the device half ──────────────────────────────────────────────────
    const manifest = driverId ? manifestOf(driverId) : undefined;
    // A 1:1 driver names its single endpoint type in the manifest, so a sheet
    // row never has to repeat it.
    const subtype = input.subtype ?? existingDevice?.subtype ?? manifest?.soloEndpointType ?? undefined;
    const endpointType = subtype ? manifest?.endpointTypes.find((e) => e.type === subtype) : undefined;

    if (isCreate && !input.name) return fail(errors, index, "name is required", "name");
    if (isCreate && !input.type) return fail(errors, index, "type is required", "type");
    if (isCreate && !subtype) return fail(errors, index, "endpoint type is required", "subtype");
    if (subtype && manifest && !endpointType) {
      return fail(errors, index, `unknown endpoint type '${subtype}' for driver '${driverId}'`, "subtype");
    }

    if (input.roomId) {
      if (!(await roomExists(cache, input.roomId))) return fail(errors, index, "room not found", "roomId");
    }

    // Validate addressing whenever the row touches it, or always on create —
    // mirroring `routes/devices.ts`, which re-checks the *effective* result.
    let address: Record<string, unknown> | undefined;
    if (isCreate || input.address !== undefined || input.subtype !== undefined) {
      const merged = {
        ...((existingDevice?.address as Record<string, unknown> | undefined) ?? {}),
        ...(input.address ?? {}),
      };
      address = withSchemaDefaults(endpointType?.addressSchema, merged);
      if (driverId && subtype) {
        collectValidation(errors, index, "address", () =>
          assertValidDeviceAddress(driverId as string, subtype, address as Record<string, unknown>),
        );
      }
    }

    if (errors.length > before) return null;

    return {
      connection: connectionWrite,
      device: {
        id: existingDevice?.id,
        connectionId,
        values: definedOnly({
          name: input.name,
          type: input.type,
          subtype: isCreate ? subtype : input.subtype,
          roomId: input.roomId,
          description: input.description,
          icon: input.icon,
          address,
          // Capabilities are a projection of the endpoint type's commands, so
          // the sheet never carries them — derive them the way the single-record
          // form does, just server-side.
          capabilities:
            input.capabilities ??
            (isCreate && endpointType ? endpointType.commands.map((c) => c.command) : undefined),
          enabled: input.enabled,
        }),
      },
    };
  }

  return {
    "/api/v1/bulk/devices": {
      POST: route(async (req) => {
        const body = await readJson(req);
        const rawRows = body.rows;
        if (!Array.isArray(rawRows)) throw new HttpError(400, "BAD_REQUEST", "field 'rows' must be an array");
        if (!rawRows.length) throw new HttpError(400, "BAD_REQUEST", "field 'rows' must not be empty");
        if (rawRows.length > MAX_ROWS) {
          throw new HttpError(400, "BAD_REQUEST", `too many rows: ${rawRows.length} (max ${MAX_ROWS})`);
        }
        const dryRun = body.dryRun === true;
        const rows = rawRows.map((row, index) => asObject(row, `rows[${index}]`) as BulkDeviceRowInput);

        // ── plan (validate) every row before writing any of them ──────────
        const errors: BulkRowError[] = [];
        const cache: PlanCache = { connections: new Map(), devices: new Map(), roomIds: null };
        const planned: (BulkWriteRow | null)[] = [];
        for (const [index, row] of rows.entries()) {
          planned.push(await planRow(index, row, cache, errors));
        }

        if (errors.length) {
          log.info("bulk apply rejected", { rows: rows.length, errors: errors.length, dryRun });
          const result: BulkApplyResult = {
            ok: false,
            dryRun,
            created: 0,
            updated: 0,
            errors,
            rows: [],
          };
          return json(result);
        }

        const writes = planned.filter((row): row is BulkWriteRow => row !== null);
        const simulated: BulkRowResult[] = writes.map((write, index) => ({
          row: index,
          deviceId: write.device.id ?? "",
          connectionId: write.device.connectionId ?? write.connection?.id ?? "",
          device: write.device.id ? "updated" : "created",
          connection: write.connection ? (write.connection.id ? "updated" : "created") : "unchanged",
        }));

        if (dryRun) {
          const result: BulkApplyResult = {
            ok: true,
            dryRun: true,
            created: simulated.filter((r) => r.device === "created").length,
            updated: simulated.filter((r) => r.device === "updated").length,
            errors: [],
            rows: simulated,
          };
          return json(result);
        }

        // ── write: one transaction for the whole sheet ────────────────────
        const outcomes = await ctx.bulk.apply(writes);

        // ── reconcile the driver runtime ──────────────────────────────────
        // A connection whose row was written may have new host/port/config, so
        // it restarts (which re-reads its devices); one that only gained or lost
        // endpoints just needs its device cache refreshed.
        const toRestart = new Set<string>();
        const toRefresh = new Set<string>();
        for (const outcome of outcomes) {
          if (outcome.connectionAction === "unchanged") toRefresh.add(outcome.connectionId);
          else toRestart.add(outcome.connectionId);
        }
        for (const connectionId of toRestart) toRefresh.delete(connectionId);

        await mapLimit([...toRestart], RESTART_CONCURRENCY, async (connectionId) => {
          const row = await ctx.connections.get(connectionId);
          if (!row) return;
          await ctx.deviceManager.stopConnection(connectionId);
          if (row.enabled) await ctx.deviceManager.addConnection(toConnectionRecord(row));
        });
        await mapLimit([...toRefresh], RESTART_CONCURRENCY * 2, (connectionId) =>
          ctx.deviceManager.refreshConnectionDevices(connectionId),
        );

        const result: BulkApplyResult = {
          ok: true,
          dryRun: false,
          created: outcomes.filter((o) => o.deviceAction === "created").length,
          updated: outcomes.filter((o) => o.deviceAction === "updated").length,
          errors: [],
          rows: outcomes.map((outcome, index) => ({
            row: index,
            deviceId: outcome.deviceId,
            connectionId: outcome.connectionId,
            device: outcome.deviceAction,
            connection: outcome.connectionAction,
          })),
        };
        log.info("bulk apply", {
          rows: writes.length,
          created: result.created,
          updated: result.updated,
          connectionsRestarted: toRestart.size,
        });
        return json(result);
      }),
    },

    "/api/v1/bulk/connections": {
      POST: route(async (req) => {
        const body = await readJson(req);
        const rawRows = body.rows;
        if (!Array.isArray(rawRows)) throw new HttpError(400, "BAD_REQUEST", "field 'rows' must be an array");
        if (!rawRows.length) throw new HttpError(400, "BAD_REQUEST", "field 'rows' must not be empty");
        if (rawRows.length > MAX_ROWS) {
          throw new HttpError(400, "BAD_REQUEST", `too many rows: ${rawRows.length} (max ${MAX_ROWS})`);
        }
        const dryRun = body.dryRun === true;
        const rows = rawRows.map((row, index) => asObject(row, `rows[${index}]`) as BulkConnectionRowInput);

        const errors: BulkRowError[] = [];
        const cache: PlanCache = { connections: new Map(), devices: new Map(), roomIds: null };
        const planned: (BulkConnectionWrite | null)[] = [];
        for (const [index, row] of rows.entries()) {
          planned.push(await planConnectionRow(index, row, cache, errors));
        }

        if (errors.length) {
          log.info("bulk connection apply rejected", { rows: rows.length, errors: errors.length, dryRun });
          const rejected: BulkConnectionApplyResult = {
            ok: false,
            dryRun,
            created: 0,
            updated: 0,
            errors,
            rows: [],
          };
          return json(rejected);
        }

        const writes = planned.filter((row): row is BulkConnectionWrite => row !== null);
        if (dryRun) {
          const simulated: BulkConnectionApplyResult = {
            ok: true,
            dryRun: true,
            created: writes.filter((write) => !write.id).length,
            updated: writes.filter((write) => !!write.id).length,
            errors: [],
            rows: writes.map((write, index) => ({
              row: index,
              connectionId: write.id ?? "",
              connection: write.id ? "updated" : "created",
            })),
          };
          return json(simulated);
        }

        const outcomes = await ctx.bulk.applyConnections(writes);

        // Every written connection restarts: host/port/config may all have moved.
        await mapLimit(outcomes, RESTART_CONCURRENCY, async ({ connectionId }) => {
          const row = await ctx.connections.get(connectionId);
          if (!row) return;
          await ctx.deviceManager.stopConnection(connectionId);
          if (row.enabled) await ctx.deviceManager.addConnection(toConnectionRecord(row));
        });

        const rowResults: BulkConnectionRowResult[] = outcomes.map((outcome, index) => ({
          row: index,
          connectionId: outcome.connectionId,
          connection: outcome.action,
        }));
        const result: BulkConnectionApplyResult = {
          ok: true,
          dryRun: false,
          created: rowResults.filter((row) => row.connection === "created").length,
          updated: rowResults.filter((row) => row.connection === "updated").length,
          errors: [],
          rows: rowResults,
        };
        log.info("bulk connection apply", { rows: writes.length, created: result.created, updated: result.updated });
        return json(result);
      }),
    },

    "/api/v1/bulk/connections/delete": {
      POST: route(async (req) => {
        const body = await readJson(req);
        const rawIds = body.connectionIds;
        if (!Array.isArray(rawIds)) throw new HttpError(400, "BAD_REQUEST", "field 'connectionIds' must be an array");
        if (!rawIds.length) throw new HttpError(400, "BAD_REQUEST", "field 'connectionIds' must not be empty");
        if (rawIds.length > MAX_ROWS) {
          throw new HttpError(400, "BAD_REQUEST", `too many connections: ${rawIds.length} (max ${MAX_ROWS})`);
        }
        const connectionIds = [...new Set(rawIds.map(String))];

        // Same all-or-nothing contract, and the same refusal the single-record
        // route makes: a connection with devices on it is never cascaded away.
        const errors: BulkConnectionDeleteResult["errors"] = [];
        const known = new Set((await ctx.connections.list()).map((row) => row.id));
        for (const connectionId of connectionIds) {
          if (!known.has(connectionId)) errors.push({ connectionId, message: "connection not found" });
        }
        for (const connectionId of await ctx.bulk.connectionsWithDevices(connectionIds)) {
          errors.push({ connectionId, message: "connection still has devices; delete them first" });
        }
        if (errors.length) {
          const rejected: BulkConnectionDeleteResult = { ok: false, deletedConnections: 0, errors };
          return json(rejected);
        }

        const deleted = await ctx.bulk.deleteConnections(connectionIds);
        await mapLimit(connectionIds, RESTART_CONCURRENCY, (connectionId) =>
          ctx.deviceManager.stopConnection(connectionId),
        );
        log.info("bulk connection delete", { connections: deleted });
        const result: BulkConnectionDeleteResult = { ok: true, deletedConnections: deleted, errors: [] };
        return json(result);
      }),
    },

    "/api/v1/bulk/devices/delete": {
      POST: route(async (req) => {
        const body = await readJson(req);
        const rawIds = body.deviceIds;
        if (!Array.isArray(rawIds)) throw new HttpError(400, "BAD_REQUEST", "field 'deviceIds' must be an array");
        if (!rawIds.length) throw new HttpError(400, "BAD_REQUEST", "field 'deviceIds' must not be empty");
        if (rawIds.length > MAX_ROWS) {
          throw new HttpError(400, "BAD_REQUEST", `too many devices: ${rawIds.length} (max ${MAX_ROWS})`);
        }
        const deviceIds = [...new Set(rawIds.map(String))];
        const deleteOrphanedConnections = body.deleteOrphanedConnections === true;

        // Same all-or-nothing contract as the apply endpoint: report every
        // blocker first (a device a scene still references would otherwise
        // abort the transaction on a foreign key, taking the batch with it).
        const errors: BulkDeleteResult["errors"] = [];
        const known = new Set((await ctx.devices.list({})).map((d) => d.id));
        for (const deviceId of deviceIds) {
          if (!known.has(deviceId)) errors.push({ deviceId, message: "device not found" });
        }
        for (const deviceId of await ctx.bulk.sceneReferenced(deviceIds)) {
          errors.push({ deviceId, message: "device is used by a scene action; remove it from the scene first" });
        }
        if (errors.length) {
          const rejected: BulkDeleteResult = { ok: false, deletedDevices: 0, deletedConnections: 0, errors };
          return json(rejected);
        }

        const outcome = await ctx.bulk.deleteDevices(deviceIds, deleteOrphanedConnections);
        await mapLimit(outcome.deletedConnections, RESTART_CONCURRENCY, (connectionId) =>
          ctx.deviceManager.stopConnection(connectionId),
        );
        await mapLimit(outcome.touchedConnections, RESTART_CONCURRENCY * 2, (connectionId) =>
          ctx.deviceManager.refreshConnectionDevices(connectionId),
        );

        log.info("bulk delete", {
          devices: outcome.deletedDevices,
          connections: outcome.deletedConnections.length,
        });
        const result: BulkDeleteResult = {
          ok: true,
          deletedDevices: outcome.deletedDevices,
          deletedConnections: outcome.deletedConnections.length,
          errors: [],
        };
        return json(result);
      }),
    },
  };
}
