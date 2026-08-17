/**
 * Bulk device management contracts — the wire format of the admin UI's
 * spreadsheet editor (`POST /api/v1/bulk/devices`).
 *
 * Why a dedicated endpoint instead of looping the existing per-record routes:
 * a rack of 64 identical displays is 128 records (each display is its own
 * `connections` row *and* its own `devices` row), and 128 sequential requests
 * are neither atomic nor reviewable — a failure at row 57 would leave a
 * half-imported system behind. So one request carries every row, the server
 * validates all of them against the driver manifests first, and writes only
 * when the whole batch is sound (see `routes/bulk.ts`). Validation failures
 * come back addressed by row *and* field so the grid can paint the offending
 * cell red instead of showing one opaque error.
 *
 * The row shape deliberately nests the connection inside the device row. That
 * mirrors what the operator sees in the sheet: for a 1:1 device (a projector,
 * a display on its own IP — a driver that declares `soloEndpointType`) one row
 * *is* one physical box, and the connection/device split is an implementation
 * detail the sheet hides. For gateway drivers (a DALI bus, an Extron matrix)
 * rows carry `connectionId` instead and only devices are written.
 */

/**
 * The connection half of a bulk row. Omitted for rows that attach to an
 * existing connection via `BulkDeviceRowInput.connectionId`.
 *
 * With `id` set the connection is updated in place (its driver subprocess is
 * restarted, exactly as `PUT /connections/:id` does); without one it is
 * created. `driverId` is required when creating and ignored when updating —
 * a connection's driver is fixed at creation, same as in the single-record form.
 */
export interface BulkConnectionInput {
  /** Existing connection to update; omit to create a new one. */
  id?: string;
  name?: string;
  /** Required when creating. Ignored on update (the driver can't change). */
  driverId?: string;
  host?: string | null;
  port?: number | null;
  protocol?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * One row of a bulk apply: a device, plus optionally the connection it lives on.
 *
 * `deviceId` present → update that device; absent → create one. Exactly one of
 * `connectionId` (attach to an existing connection) or `connection` (create or
 * update one alongside the device) must be given when creating; an update may
 * omit both, which leaves the device where it is — that's the shape a
 * "assign these six rows to the Hall room" edit sends.
 *
 * Every other field is optional and follows patch semantics on update: absent
 * means "leave as is", so a room-assignment row is `{ deviceId, roomId }` and
 * nothing else.
 */
export interface BulkDeviceRowInput {
  /** Existing device to update; omit to create a new one. */
  deviceId?: string;
  /** Attach to this existing connection. Mutually exclusive with `connection`. */
  connectionId?: string;
  /** Create/update the device's own connection in the same batch (1:1 rows). */
  connection?: BulkConnectionInput;
  name?: string;
  /** Device category (`display`, `audio`, …) — the `devices.type` column. */
  type?: string;
  /** Driver endpoint type (`samsung-mdc.display`), the `devices.subtype` column. */
  subtype?: string;
  roomId?: string | null;
  description?: string | null;
  icon?: string | null;
  address?: Record<string, unknown>;
  capabilities?: string[];
  enabled?: boolean;
}

/** Body accepted by `POST /api/v1/bulk/devices`. */
export interface BulkApplyInput {
  rows: BulkDeviceRowInput[];
  /**
   * Validate every row and report the outcome without writing anything — what
   * the sheet's "Check" action runs before a large import.
   */
  dryRun?: boolean;
}

/**
 * One thing wrong with one row, addressed precisely enough for the grid to
 * highlight a single cell.
 *
 * `field` uses the same dotted paths the sheet's columns are keyed by:
 * `name`, `roomId`, `connection.host`, `address.displayId`, … It is absent
 * only for problems that belong to the row as a whole (e.g. a row that names
 * neither a connection nor a device).
 */
export interface BulkRowError {
  /** Index into the submitted `rows` array. */
  row: number;
  /** Dotted path of the offending field, when the problem is a single value. */
  field?: string;
  message: string;
}

/** What happened to one record in a bulk apply. */
export type BulkRecordAction = "created" | "updated" | "unchanged";

/** Per-row outcome of a successful apply (or of a dry run's simulation). */
export interface BulkRowResult {
  row: number;
  /** Empty on a dry run — nothing was written, so there is no id yet. */
  deviceId: string;
  connectionId: string;
  device: BulkRecordAction;
  connection: BulkRecordAction;
}

/**
 * Result of `POST /api/v1/bulk/devices`. Returned with HTTP 200 even when
 * `ok` is false: a batch rejected on validation is a normal, expected outcome
 * the grid renders inline (red cells), not a transport-level error. Malformed
 * requests — a non-array `rows`, an unparseable body — still fail with 400.
 */
export interface BulkApplyResult {
  /** False when `errors` is non-empty; nothing was written in that case. */
  ok: boolean;
  dryRun: boolean;
  /** Devices created / updated (a 1:1 row may also have touched a connection). */
  created: number;
  updated: number;
  errors: BulkRowError[];
  rows: BulkRowResult[];
}

/** Body accepted by `POST /api/v1/bulk/devices/delete`. */
export interface BulkDeleteInput {
  deviceIds: string[];
  /**
   * Also delete each affected connection once the batch leaves it with no
   * devices — the counterpart of 1:1 rows, where deleting the display should
   * take its connection with it instead of stranding an empty one.
   */
  deleteOrphanedConnections?: boolean;
}

export interface BulkDeleteResult {
  ok: boolean;
  deletedDevices: number;
  deletedConnections: number;
  errors: Array<{ deviceId: string; message: string }>;
}

// ── connections ─────────────────────────────────────────────────────────────

/**
 * One row of a connection sheet: a physical socket, with nothing above it.
 *
 * This is the sheet that matters for standing up a site — twenty NETIOs or
 * sixty displays are twenty or sixty *connections*, each just a name and an
 * address, and none of them need an endpoint decided before they can exist.
 * Driver-specific `config` is optional here on purpose: the server fills in
 * every property the driver's `connectionSchema` gives a default for, so a
 * sheet that shows only name/host/port produces valid connections.
 */
export interface BulkConnectionRowInput {
  /** Existing connection to update; omit to create a new one. */
  connectionId?: string;
  name?: string;
  /** Required when creating. Ignored on update — a connection's driver is fixed. */
  driverId?: string;
  host?: string | null;
  port?: number | null;
  protocol?: string;
  /** Merged over the manifest defaults; omit entirely to accept them all. */
  config?: Record<string, unknown>;
  enabled?: boolean;
}

/** Body accepted by `POST /api/v1/bulk/connections`. */
export interface BulkConnectionApplyInput {
  rows: BulkConnectionRowInput[];
  dryRun?: boolean;
}

export interface BulkConnectionRowResult {
  row: number;
  /** Empty on a dry run — nothing was written, so there is no id yet. */
  connectionId: string;
  connection: BulkRecordAction;
}

/**
 * Result of `POST /api/v1/bulk/connections` — same contract as the device
 * apply: 200 with `ok: false` and cell-addressed errors when the batch is
 * rejected, and nothing written in that case.
 */
export interface BulkConnectionApplyResult {
  ok: boolean;
  dryRun: boolean;
  created: number;
  updated: number;
  errors: BulkRowError[];
  rows: BulkConnectionRowResult[];
}

/** Body accepted by `POST /api/v1/bulk/connections/delete`. */
export interface BulkConnectionDeleteInput {
  connectionIds: string[];
}

export interface BulkConnectionDeleteResult {
  ok: boolean;
  deletedConnections: number;
  /** A connection that still carries devices is reported, never silently cascaded. */
  errors: Array<{ connectionId: string; message: string }>;
}
