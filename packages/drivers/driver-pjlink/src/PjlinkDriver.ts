/**
 * PJLink Class 1 projector driver.
 *
 * Protocol summary (PJLink Class 1, TCP/4352, ASCII, CR-terminated):
 *  - On connect the projector sends a banner: `PJLINK 0` (no auth) or
 *    `PJLINK 1 <8-hex-seed>` (auth required).
 *  - For auth, the client prefixes its command with `md5(seed + password)`.
 *  - Commands look like `%1POWR 1` (set) or `%1POWR ?` (query); responses look
 *    like `%1POWR=1`. A set that succeeds answers `=OK`. Per-command errors come
 *    back as `=ERR1`..`=ERR4`; an authentication failure is `PJLINK ERRA`.
 *  - Multiple commands may be sent on one connection (manual §5.3). The projector
 *    **forcibly disconnects after 30 s of inactivity** (manual §5.4), so a
 *    persistent socket is impossible — every poll/command uses a short-lived
 *    connection that opens, runs its commands, and closes.
 *
 * Because the link is not permanent we cannot "watch" the socket for liveness.
 * Instead the driver runs its own **poll timer** (default 30 s): each tick opens
 * a connection, asks the projector for its status, emits a `state` event (so all
 * UIs see the real power/input), and tracks online/offline. The rule the user
 * asked for: **any response — even an `ERR` — means the projector is online; only
 * a failed connection means offline.** Connected/disconnected are emitted only on
 * an actual transition, never once per poll.
 *
 * AVMT (mute) is never polled — only sent on explicit `setMute` commands.
 * ERST (error status) is polled at a lower rate (default 60 s, configurable via
 * `erstIntervalMs`) to reduce traffic.
 *
 * The watchdog's connection health check (`healthCheck`) therefore does no I/O —
 * it returns the cached flag the poll timer maintains, so it can never time out
 * or double-poll the projector.
 */

import { EventEmitter } from "node:events";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
  errMsg,
  TcpClient,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";

/** Queries sent on every regular poll. */
const POLL_COMMANDS = ["%1POWR ?", "%1INPT ?"] as const;
/** Extra query sent on the slow (ERST) poll. */
const ERST_COMMAND = "%1ERST ?" as const;

/** Friendly input names → PJLink 2-digit input codes (class digit + number). */
const INPUT_ALIASES: Record<string, string> = {
  RGB1: "11", RGB2: "12",
  VIDEO1: "21", VIDEO2: "22",
  DVI: "31", DVID: "31", "DVI-D": "31", DIGITAL1: "31",
  HDMI: "32", HDMI1: "31", HDMI2: "32", DIGITAL2: "32",
  DIGITALLINK: "33", DIGITAL3: "33",
  SDI1: "34", SDI2: "35",
  STORAGE1: "41", USB: "41",
  NETWORK1: "51", LAN: "52",
  HDBASET: "56",
};

/** Class digit → input class label (PJLink spec). */
const INPUT_CLASS: Record<string, string> = {
  "1": "RGB", "2": "Video", "3": "Digital", "4": "Storage", "5": "Network", "6": "Internal",
};

/** Human-readable messages for PJLink error codes. */
const ERR_MESSAGES: Record<string, string> = {
  ERR1: "undefined command",
  ERR2: "parameter out of range (e.g. no such input)",
  ERR3: "unavailable time (projector warming up, cooling down, or in standby)",
  ERR4: "projector/display failure",
  ERRA: "authentication error (wrong or missing password)",
};

/** Error-status digit → label (each digit of an ERST value). */
const ERROR_STATE: Record<string, string> = {
  "0": "ok", "1": "warning", "2": "error",
};

export class PjlinkDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private host = "";
  private port = 4352;
  private password = "";
  /** Timeout for each network I/O step (connect, banner read, response read). */
  private timeoutMs = 2000;
  /** How often the poll timer asks the projector for its status. */
  private pollIntervalMs = 30_000;
  /** How often the slower ERST query runs (default 60 s). */
  private erstIntervalMs = 60_000;

  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  private lastLatencyMs: number | undefined;
  /** Device id of the single projector endpoint, learned via subscribe. */
  private endpointId: string | null = null;
  /** Last known state, used to carry fields forward when a query errors. */
  private lastState: Record<string, unknown> = {};
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Timestamp of the last ERST query (ms), used to gate infrequent polling. */
  private lastErstPollMs = 0;

  /** In-memory state used in dry-run mode. */
  private simState: Record<string, unknown> = { power: "off", input: "31" };

  /** Serialises all device I/O — one connection / transaction at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 4352;
    this.password = String(config.config.password ?? "");
    this.timeoutMs = Number(config.config.responseTimeoutMs ?? 2000);
    this.pollIntervalMs = Number(config.config.pollIntervalMs ?? 30_000);
    this.erstIntervalMs = Number(config.config.erstIntervalMs ?? 60_000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
      this.stopPolling();
    });
    ctx.logger.debug("pjlink init", {
      host: this.host,
      port: this.port,
      pollIntervalMs: this.pollIntervalMs,
    });
  }

  /**
   * "Connecting" here just starts the poll loop and does an immediate probe.
   * There is no permanent socket to hold open; liveness comes from the poll.
   */
  async connect(): Promise<void> {
    this.startPolling();
    await this.pollOnce();
  }

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.online = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.stopPolling();
    this.online = false;
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.online;
  }

  /**
   * Connection-level health (watchdog layer 1). Does **no** I/O: the poll timer
   * already maintains the online flag, so this returns the cached value. That
   * keeps the 10 s watchdog cheap and stops it ever reporting a false timeout.
   */
  async healthCheck(): Promise<HealthStatus> {
    return { online: this.online, latencyMs: this.lastLatencyMs, checkedAt: new Date() };
  }

  /** Record the projector endpoint and push its state to the UI right away. */
  async subscribeToEndpoint(endpoint: EndpointDescriptor): Promise<void> {
    this.endpointId = endpoint.id;
    // Reset the ERST clock so the first subscribe poll always fetches full state.
    this.lastErstPollMs = 0;
    this.startPolling();
    await this.pollOnce();
  }

  async unsubscribeFromEndpoint(_endpoint: EndpointDescriptor): Promise<void> {
    this.endpointId = null;
  }

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();
    this.endpointId = endpoint.id;

    if (this.ctx.dryRun) {
      const state = this.applyDryRun(command, params);
      this.ctx.logger.info("pjlink dry-run command", { command, params });
      return { success: true, durationMs: Date.now() - start, state };
    }

    let line: string;
    try {
      line = buildCommand(command, params);
    } catch (err) {
      return { success: false, durationMs: Date.now() - start, error: errMsg(err) };
    }

    try {
      const results = await this.serialize(() => this.runSession([line]));
      // The projector answered, so it is reachable → online. The command just
      // refreshed contact, so push the next poll out a full interval.
      this.setOnline(true);
      this.resetPollTimer();

      const value = results[commandNameOf(line)];
      if (value && isErr(value)) {
        const message = `${value}: ${ERR_MESSAGES[value] ?? "device error"}`;
        this.ctx.logger.warn("pjlink command rejected", { command, error: message });
        return { success: false, durationMs: Date.now() - start, error: message };
      }

      const state = this.optimisticState(command, params);
      this.lastState = { ...this.lastState, ...state };
      this.emit("state", { endpointId: endpoint.id, state, source: "echo", timestamp: new Date() });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      // A failed *connection* means the projector is unreachable → offline.
      const message = errMsg(err);
      this.setOnline(false, message);
      this.ctx.logger.warn("pjlink command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    this.endpointId = endpoint.id;
    if (this.ctx.dryRun) return { ...this.simState };

    try {
      const results = await this.serialize(() => this.runSession([...POLL_COMMANDS, ERST_COMMAND]));
      this.setOnline(true);
      this.lastErstPollMs = Date.now();
      const state = buildState(results);
      this.lastState = { ...this.lastState, ...state };
      this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
      return state;
    } catch (err) {
      this.setOnline(false, errMsg(err));
      throw err;
    }
  }

  // ── poll loop ──────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer || this.destroyed) return;
    this.pollTimer = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
  }

  /**
   * Restart the poll countdown. Called after a user command has just talked to
   * the projector, so the next poll is a full interval away instead of firing
   * right on the heels of the command — fewer connections, no redundant probe.
   */
  private resetPollTimer(): void {
    if (this.destroyed || !this.pollTimer) return;
    this.stopPolling();
    this.startPolling();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * One status poll: connect, ask the projector for POWR/INPT (and ERST when
   * `erstIntervalMs` has elapsed), emit the resulting state, and update the online
   * flag. Any response keeps us online; only a connection failure flips us offline.
   * Never throws.
   */
  private async pollOnce(): Promise<void> {
    if (this.destroyed) return;

    if (this.ctx.dryRun) {
      this.setOnline(true);
      if (this.endpointId) {
        this.emit("state", {
          endpointId: this.endpointId,
          state: { ...this.simState },
          source: "poll",
          timestamp: new Date(),
        });
      }
      return;
    }

    const now = Date.now();
    const includeErst = now - this.lastErstPollMs >= this.erstIntervalMs;
    const commands: string[] = [...POLL_COMMANDS];
    if (includeErst) commands.push(ERST_COMMAND);

    const start = now;
    try {
      const results = await this.serialize(() => this.runSession(commands));
      this.lastLatencyMs = Date.now() - start;
      if (includeErst) this.lastErstPollMs = Date.now();
      this.setOnline(true);
      const state = buildState(results);
      this.lastState = { ...this.lastState, ...state };
      if (this.endpointId) {
        this.emit("state", {
          endpointId: this.endpointId,
          state,
          source: "poll",
          timestamp: new Date(),
        });
      }
    } catch (err) {
      this.setOnline(false, errMsg(err));
    }
  }

  /** Flip the online flag and emit connected/disconnected only on a transition. */
  private setOnline(online: boolean, reason = "no response"): void {
    if (this.online === online) return;
    this.online = online;
    if (online) {
      this.ctx.logger.info("pjlink online", { host: this.host });
      this.emit("connected");
    } else {
      this.lastLatencyMs = undefined;
      this.ctx.logger.warn("pjlink offline", { host: this.host, reason });
      this.emit("disconnected", reason);
    }
  }

  // ── command translation ────────────────────────────────────

  private applyDryRun(command: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (command) {
      case "on": this.simState.power = "on"; break;
      case "off": this.simState.power = "off"; break;
      case "setInput": this.simState.input = resolveInput(String(params.input ?? "")); break;
    }
    return { ...this.simState };
  }

  /**
   * Optimistic state applied after a command is accepted (the poll confirms it).
   * Power reflects the requested on/off intent; the next poll reports the true
   * transitional state (`warming`/`cooling`) and then the settled value.
   */
  private optimisticState(command: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (command) {
      case "on": return { power: "on" };
      case "off": return { power: "off" };
      case "setInput": {
        const code = resolveInput(String(params.input ?? ""));
        return { input: code, inputLabel: inputLabel(code) };
      }
      case "setMute": return { muted: Boolean(params.muted) };
      default: return {};
    }
  }

  // ── transport ──────────────────────────────────────────────

  /** Serialise device I/O behind a single chain (one socket at a time). */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Run one PJLink session over a short-lived connection: open, read the auth
   * banner, then send each command (digest-prefixed when auth is enabled) and
   * collect its response. Returns a map of command name → value (e.g.
   * `{ POWR: "1", INPT: "31" }`). Throws only on a transport/auth failure.
   */
  private async runSession(commands: string[]): Promise<Record<string, string>> {
    if (this.destroyed) throw new Error("driver destroyed");

    const client = new TcpClient({
      hostname: this.host,
      port: this.port,
      rxDelimiter: "\r",
      txDelimiter: "\r",
      encoding: "latin1",
      connectTimeoutMs: this.timeoutMs,
      // PJLink projectors accept a single connection and only release the slot
      // when the connection is fully gone. A graceful half-close (FIN) leaves the
      // projector holding the slot until its own ~30 s idle timeout, which races
      // with our next poll and makes the connect time out. Force a hard close
      // (RST) so the slot is freed the instant we're done.
      closeMode: "force",
    });

    await client.connect();
    try {
      const banner = await client.receive(this.timeoutMs);
      const prefix = this.authPrefix(banner);
      const out: Record<string, string> = {};

      for (const command of commands) {
        this.ctx.logger.debug("pjlink tx →", { host: this.host, body: command });
        let response: string;
        try {
          response = await client.request(prefix + command, this.timeoutMs);
        } catch (err) {
          // The manual (§5.3) lets a projector accept many commands on one
          // connection, but some close after each response. Once we have the
          // banner the projector is proven reachable, so keep whatever we've
          // collected rather than failing the whole poll.
          this.ctx.logger.debug("pjlink session ended early", { command, error: errMsg(err) });
          break;
        }
        this.ctx.logger.debug("pjlink rx ←", { host: this.host, response });

        const parsed = parseLine(response);
        if (parsed.authFailed) throw new Error(ERR_MESSAGES.ERRA);
        if (parsed.command) out[parsed.command] = parsed.value;
      }
      return out;
    } finally {
      client.close();
    }
  }

  /** Compute the auth digest prefix from the projector's banner line. */
  private authPrefix(banner: string): string {
    const trimmed = banner.replace(/\0/g, "").trim();
    if (/^PJLINK\s+0\b/i.test(trimmed) || trimmed === "PJLINK 0") return "";
    const match = /^PJLINK\s+1\s+(\S+)/i.exec(trimmed);
    if (match) {
      if (!this.password) throw new Error("projector requires a password but none configured");
      return new Bun.CryptoHasher("md5").update(match[1] + this.password).digest("hex");
    }
    if (/^PJLINK\s+ERRA/i.test(trimmed)) throw new Error(ERR_MESSAGES.ERRA);
    throw new Error(`unexpected PJLink banner: ${trimmed || "<empty>"}`);
  }
}

// ── pure helpers ─────────────────────────────────────────────

/** True for a PJLink error value such as `ERR1`..`ERR4`. */
function isErr(value: string): boolean {
  return /^ERR[1-4]$/i.test(value.trim());
}

interface ParsedLine {
  command?: string;
  value: string;
  authFailed?: boolean;
}

/**
 * Parse a PJLink response line into `{ command, value }`. Tolerates the stray
 * NUL bytes some projectors emit and a leading LF when the device frames with
 * CRLF. `PJLINK ERRA` (auth failure) is flagged separately.
 */
function parseLine(response: string): ParsedLine {
  const trimmed = response.replace(/\0/g, "").trim();
  if (/^PJLINK\s+ERRA/i.test(trimmed)) return { value: trimmed, authFailed: true };
  const match = /^%(\d)([A-Za-z]{4})=(.*)$/.exec(trimmed);
  if (match) return { command: match[2]!.toUpperCase(), value: match[3]!.trim() };
  return { value: trimmed };
}

/** The 4-letter command name in a request line, e.g. `%1POWR 1` → `POWR`. */
function commandNameOf(line: string): string {
  return line.slice(2, 6).toUpperCase();
}

/** Build the request line for a high-level command. Throws on unknown commands. */
function buildCommand(command: string, params: Record<string, unknown>): string {
  switch (command) {
    case "on": return "%1POWR 1";
    case "off": return "%1POWR 0";
    case "setInput": return `%1INPT ${resolveInput(String(params.input ?? ""))}`;
    case "setMute": return `%1AVMT ${params.muted ? "31" : "30"}`;
    default: throw new Error(`unknown command: ${command}`);
  }
}

function resolveInput(input: string): string {
  const upper = input.trim().toUpperCase();
  if (INPUT_ALIASES[upper]) return INPUT_ALIASES[upper]!;
  if (/^[1-9][0-9A-Z]$/.test(upper)) return upper; // already a valid PJLink code
  throw new Error(`invalid input: ${input}`);
}

/** Friendly label for a raw 2-digit input code, e.g. `31` → `Digital (31)`. */
function inputLabel(code: string): string {
  const cls = INPUT_CLASS[code[0] ?? ""];
  return cls ? `${cls} (${code})` : code;
}

function mapPower(code: string): string {
  switch (code) {
    case "0": return "off";
    case "1": return "on";
    case "2": return "cooling";
    case "3": return "warming";
    default: return "unknown";
  }
}

/** Decode an ERST value (6 digits: fan, lamp, temp, cover, filter, other). */
function parseErst(code: string): Record<string, string> {
  const fields = ["fan", "lamp", "temperature", "cover", "filter", "other"] as const;
  const errors: Record<string, string> = {};
  fields.forEach((field, i) => {
    errors[field] = ERROR_STATE[code[i] ?? "0"] ?? "unknown";
  });
  return errors;
}

/**
 * Build a state patch from a poll's responses. Only fields whose query succeeded
 * are included (a projector in standby answers `ERR3` to INPT/AVMT); the Redis
 * store merges the patch, so the last known input/mute is preserved meanwhile.
 */
function buildState(results: Record<string, string>): Record<string, unknown> {
  const state: Record<string, unknown> = {};

  const powr = results.POWR;
  if (powr !== undefined && !isErr(powr)) state.power = mapPower(powr);

  const inpt = results.INPT;
  if (inpt && !isErr(inpt)) {
    state.input = inpt;
    state.inputLabel = inputLabel(inpt);
  }

  const erst = results.ERST;
  if (erst && !isErr(erst) && /^\d{6}$/.test(erst)) state.errors = parseErst(erst);

  return state;
}
