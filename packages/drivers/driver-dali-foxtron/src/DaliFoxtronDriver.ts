/**
 * Foxtron DALI gateway driver (DALInet / DALI2net — TCP ASCII protocol).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TRANSPORT MODEL: per-command TCP connections (short-lived).
 *
 * The Foxtron DALInet/DALI2net closes idle TCP connections after ~1–2 s of
 * inactivity. The device is NOT designed for persistent long-lived sockets;
 * it queues incoming messages (buffer of 16) and the working reference script
 * (manuals/bss.js) connects, sends ONE frame, and closes.
 *
 * Therefore every driver operation opens a fresh TCP connection, sends the
 * Foxtron frame, optionally waits for the reply, then closes. Commands are
 * serialised through a promise chain so at most one connection is open at once.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Operations:
 *   on / off / setBrightness / recall
 *     → Type 1 frame (fire-and-forget): connect → write → close
 *
 *   readState
 *     → Type 11 frame: connect → write → wait for Type 13 / 14 reply → close
 *
 *   healthCheck
 *     → Type 6 config query: connect → write → wait for Type 7 reply → close
 *
 *   connect()
 *     → TCP probe (connect + immediate close) to verify reachability
 */

import { EventEmitter } from "node:events";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";
import {
  type DaliTarget,
  DaliCmd,
  FrameDecoder,
  MsgType,
  buildConfigQuery,
  buildSendDali,
  buildSendDaliOrig,
  dapcToLevel,
  encodeFrame,
  levelToDapc,
  targetCmdByte,
  targetDapcByte,
  targetKey,
  targetLabel,
} from "./foxtron-codec.ts";

interface FixtureState extends Record<string, unknown> {
  on: boolean;
  brightness: number;
}

export class DaliFoxtronDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config ─────────────────────────────────────────────────
  private host = "";
  private port = 23;
  private responseTimeoutMs = 1000;

  // ── runtime ────────────────────────────────────────────────
  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;

  /** Serialise all network operations: one connection open at a time. */
  private chain: Promise<unknown> = Promise.resolve();

  /** Optimistic state cache + dry-run state, keyed by target (e.g. "a5", "g2", "bc"). */
  private readonly stateCache = new Map<string, FixtureState>();
  private readonly simState  = new Map<string, FixtureState>();

  // ── lifecycle ──────────────────────────────────────────────

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 23;
    this.responseTimeoutMs = Number(config.config.responseTimeoutMs ?? 1000);
    ctx.signal.addEventListener("abort", () => { this.destroyed = true; });
    ctx.logger.debug("dali-foxtron init", { host: this.host, port: this.port });
  }

  async connect(): Promise<void> {
    if (this.ctx.dryRun) {
      this.online = true;
      this.emit("connected");
      return;
    }
    // Verify the gateway is reachable (TCP connect + immediate close).
    await this.tcpProbe();
    this.online = true;
    this.emit("connected");
  }

  async disconnect(): Promise<void> {
    // Stateless transport — nothing to tear down.
    this.online = false;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.online;
  }

  // ── status ─────────────────────────────────────────────────

  /**
   * Health check via a Type 6 converter config query (item 3 = DALI bus power
   * status: 0=OK, 1=power lost/short, 2=mains voltage, 3=bad source).
   */
  async healthCheck(): Promise<HealthStatus> {
    if (this.ctx.dryRun) {
      return { online: this.online, checkedAt: new Date() };
    }
    const start = Date.now();
    try {
      const reply = await this.serialized(() =>
        this.sendAndReceive(encodeFrame(buildConfigQuery(3)), MsgType.CONFIG_RESP),
      );
      const busStatus = ((reply[2] ?? 0) << 8) | (reply[3] ?? 0);
      const ok = busStatus === 0;
      this.online = ok;
      return {
        online: ok,
        latencyMs: Date.now() - start,
        details: ok ? undefined : `DALI bus status code ${busStatus}`,
        checkedAt: new Date(),
      };
    } catch (err) {
      this.online = false;
      return {
        online: false,
        details: err instanceof Error ? err.message : String(err),
        checkedAt: new Date(),
      };
    }
  }

  // ── commands ───────────────────────────────────────────────

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    try {
      // parseTarget is inside the try so an invalid address fails gracefully.
      const target = parseTarget(endpoint);

      if (this.ctx.dryRun) {
        const state = this.applyDryRun(target, command, params);
        return { success: true, durationMs: Date.now() - start, state };
      }

      const { frame, state } = this.buildCommand(target, command, params);
      await this.serialized(() => this.sendAndClose(frame));
      this.online = true;
      this.stateCache.set(targetKey(target), state);
      this.emit("state", {
        endpointId: endpoint.id,
        state,
        source: "echo",
        timestamp: new Date(),
      });
      this.ctx.logger.debug("dali-foxtron command ok", { command, target: targetLabel(target) });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("dali-foxtron command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  // ── readState ──────────────────────────────────────────────

  /**
   * Query the current brightness via DALI "Query Actual Level" (cmd 0xA0).
   * Uses Type 11 so the device's response is Type 13/14 (attributed to us),
   * not Type 3/4 (which cover ALL DALI bus activity including other masters).
   */
  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    const target = parseTarget(endpoint);
    const key = targetKey(target);

    if (this.ctx.dryRun) {
      return { ...(this.simState.get(key) ?? { on: false, brightness: 0 }) };
    }

    // Group / broadcast can't be queried reliably — multiple gear would answer
    // at once and the reply is unreadable. Return the last optimistic state.
    if (target.mode !== "address") {
      return { ...(this.stateCache.get(key) ?? { on: false, brightness: 0 }) };
    }

    const frame = encodeFrame(
      buildSendDaliOrig([targetCmdByte(target), DaliCmd.QUERY_LEVEL]),
    );
    const reply = await this.serialized(() =>
      this.sendAndReceive(frame, MsgType.ORIG_WITH_REPLY),
    );

    this.online = true;

    // Reply structure: [type, bitLen, addrByte, cmdByte, replyBitLen, replyByte?]
    // replyBitLen=8 → fixture replied; replyBitLen=0 → no reply (Type 14)
    let dapc: number | null = null;
    if (reply[0] === MsgType.ORIG_WITH_REPLY && reply.length >= 6 && (reply[4] ?? 0) > 0) {
      dapc = reply[5] ?? null;
    }
    // ORIG_NO_REPLY (type 14) or no data → fixture absent / not responding

    const on = dapc !== null && dapc > 0;
    const brightness = dapc !== null ? dapcToLevel(dapc) : 0;
    const state: FixtureState = { on, brightness };
    this.stateCache.set(key, state);
    this.emit("state", {
      endpointId: endpoint.id,
      state,
      source: "poll",
      timestamp: new Date(),
    });
    return state;
  }

  // ── command builder ────────────────────────────────────────

  private buildCommand(
    target: DaliTarget,
    command: string,
    params: Record<string, unknown>,
  ): { frame: Buffer; state: FixtureState } {
    switch (command) {
      case "on":
        return {
          frame: encodeFrame(buildSendDali([targetCmdByte(target), DaliCmd.RECALL_MAX])),
          state: { on: true, brightness: 1 },
        };
      case "off":
        return {
          frame: encodeFrame(buildSendDali([targetCmdByte(target), DaliCmd.OFF])),
          state: { on: false, brightness: 0 },
        };
      case "setBrightness": {
        const level = Math.max(0, Math.min(1, Number(params.level)));
        return {
          frame: encodeFrame(buildSendDali([targetDapcByte(target), levelToDapc(level)])),
          state: { on: level > 0, brightness: level },
        };
      }
      case "recall": {
        const scene = Number(params.scene);
        if (!Number.isInteger(scene) || scene < 0 || scene > 15) {
          throw new Error(`invalid scene: ${params.scene} (expected 0–15)`);
        }
        const cached = this.stateCache.get(targetKey(target));
        return {
          frame: encodeFrame(buildSendDali([targetCmdByte(target), DaliCmd.RECALL_SCENE_0 + scene])),
          state: { on: true, brightness: cached?.brightness ?? 0.5 },
        };
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(target: DaliTarget, command: string, params: Record<string, unknown>): FixtureState {
    const key = targetKey(target);
    const sim = this.simState.get(key) ?? { on: false, brightness: 0 };
    const next: FixtureState = { ...sim };
    switch (command) {
      case "on":          next.on = true;  next.brightness = 1; break;
      case "off":         next.on = false; next.brightness = 0; break;
      case "setBrightness": {
        const level = Math.max(0, Math.min(1, Number(params.level)));
        next.brightness = level;
        next.on = level > 0;
        break;
      }
      case "recall": break;
      default: throw new Error(`unknown command: ${command}`);
    }
    this.simState.set(key, next);
    return next;
  }

  // ── serialisation ──────────────────────────────────────────

  /** Run fn after the previous operation finishes (one connection at a time). */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(() => fn());
    this.chain = p.then(() => undefined, () => undefined);
    return p;
  }

  // ── low-level transports ───────────────────────────────────

  /**
   * Open a TCP connection and immediately close it.
   * Used by connect() to verify gateway reachability without sending any data.
   */
  private tcpProbe(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.destroyed) { reject(new Error("driver destroyed")); return; }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("connect timeout"));
      }, this.responseTimeoutMs);

      Bun.connect({
        hostname: this.host,
        port: this.port,
        socket: {
          open: (s) => {
            clearTimeout(timer);
            done = true;
            s.end();
            resolve();
          },
          connectError: (_s, err) => {
            if (done) return;
            done = true; clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          },
          error: (_s, err) => {
            if (done) return;
            done = true; clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          },
          data: () => {},
          close: () => {},
          end: () => {},
        },
      }).catch((err) => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
    });
  }

  /**
   * Connect → write frame → resolve immediately (fire-and-forget).
   * The OS TCP stack ensures the bytes are delivered; the device buffers them.
   * The socket is closed gracefully after a short delay.
   */
  private sendAndClose(frame: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.destroyed) { reject(new Error("driver destroyed")); return; }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error("connect timeout"));
      }, this.responseTimeoutMs);

      Bun.connect({
        hostname: this.host,
        port: this.port,
        socket: {
          open: (s) => {
            clearTimeout(timer);
            done = true;
            this.ctx.logger.debug("dali-foxtron →", { hex: frame.toString("hex") });
            s.write(frame);
            resolve(); // The data is in the TCP send buffer — command is on its way.
            // Close gracefully after a short delay to let the OS flush the write.
            setTimeout(() => { if (!this.destroyed) s.end(); }, 150);
          },
          connectError: (_s, err) => {
            if (done) return;
            done = true; clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
          },
          error: () => {
            // Already resolved — connection errors during close are non-fatal.
          },
          data: () => {}, // Ignore Type 3/4 confirmations
          close: () => {},
          end: () => {},
        },
      }).catch((err) => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
    });
  }

  /**
   * Connect → write frame → wait for a specific inbound message type → close.
   * For ORIG_WITH_REPLY (Type 13), also accepts ORIG_NO_REPLY (Type 14) so a
   * "fixture not responding" answer terminates the wait instead of timing out.
   */
  private sendAndReceive(frame: Buffer, expectedType: number): Promise<number[]> {
    const acceptNoReply = expectedType === MsgType.ORIG_WITH_REPLY;

    return new Promise<number[]>((resolve, reject) => {
      if (this.destroyed) { reject(new Error("driver destroyed")); return; }
      const decoder = new FrameDecoder();
      let done = false;

      const finish = (result: number[] | Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const timer = setTimeout(
        () => finish(new Error(`reply timeout after ${this.responseTimeoutMs}ms`)),
        this.responseTimeoutMs,
      );

      Bun.connect({
        hostname: this.host,
        port: this.port,
        socket: {
          open: (s) => {
            this.ctx.logger.debug("dali-foxtron →", { hex: frame.toString("hex") });
            s.write(frame);
            // Leave the socket open to receive the reply.
          },
          data: (s, chunk) => {
            for (const data of decoder.push(chunk)) {
              this.ctx.logger.debug("dali-foxtron ←", {
                type: data[0],
                hex: data.map((b) => b.toString(16).padStart(2, "0")).join(" "),
              });
              if (
                data[0] === expectedType ||
                (acceptNoReply && data[0] === MsgType.ORIG_NO_REPLY)
              ) {
                finish(data); // Resolve FIRST (sets done=true before s.end() can fire close)
                s.end();      // Then half-close; any subsequent close/end events are no-ops
                return;
              }
              // Ignore unsolicited Type 3/4/5 (DALI activity from other masters).
            }
          },
          close: () => finish(new Error("connection closed before reply")),
          end:   () => finish(new Error("remote closed before reply")),
          error: (_s, err) => finish(err instanceof Error ? err : new Error(String(err))),
          connectError: (_s, err) => finish(err instanceof Error ? err : new Error(String(err))),
        },
      }).catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
    });
  }
}

// ── pure helpers ─────────────────────────────────────────────

/**
 * Resolve an endpoint's address into a {@link DaliTarget}.
 *
 * Supports three modes via `addressMode`:
 *   - "address"   → individual short address (`daliAddress`, 0–63)
 *   - "group"     → DALI group (`group`, 0–15)
 *   - "broadcast" → all fixtures on the bus
 *
 * Backward-compatible: when `addressMode` is omitted, presence of `daliAddress`
 * implies "address" and presence of only `group` implies "group".
 */
function parseTarget(endpoint: EndpointDescriptor): DaliTarget {
  const a = endpoint.address;
  let mode = a.addressMode != null ? String(a.addressMode).toLowerCase() : "";

  // Infer the mode when not explicitly set.
  if (mode === "") {
    if (a.daliAddress !== undefined) mode = "address";
    else if (a.group !== undefined) mode = "group";
    else throw new Error("invalid address: provide daliAddress, group, or addressMode");
  }

  switch (mode) {
    case "broadcast":
      return { mode: "broadcast" };

    case "group": {
      const group = Number(a.group);
      if (!Number.isInteger(group) || group < 0 || group > 15) {
        throw new Error(`invalid group: expected 0–15 (got ${a.group})`);
      }
      return { mode: "group", group };
    }

    case "address": {
      const address = Number(a.daliAddress);
      if (!Number.isInteger(address) || address < 0 || address > 63) {
        throw new Error(`invalid daliAddress: expected 0–63 (got ${a.daliAddress})`);
      }
      return { mode: "address", address };
    }

    default:
      throw new Error(`invalid addressMode: ${a.addressMode} (expected address|group|broadcast)`);
  }
}
