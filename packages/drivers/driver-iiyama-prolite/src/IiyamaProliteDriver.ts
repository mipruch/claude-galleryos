/**
 * Iiyama ProLite display driver.
 *
 * There is no persistent link: powering **on** is a fire-and-forget UDP
 * Wake-on-LAN magic packet (the display accepts no TCP connections while
 * off), and powering **off** / reading power state are single-shot RS232-
 * over-LAN transactions (TCP 5000) — open a socket, send one frame, wait for
 * the display's report, close. This mirrors the PJLink driver's approach to
 * a device that cannot hold a socket open, just for a different reason.
 *
 * `off` waits for the display's Communication Control confirmation
 * (function 0x00, status "Completed") before resolving — the request only
 * reports success once the display has actually acknowledged the power-off,
 * per the manufacturer's documented sequence.
 *
 * `online` tracks *network* reachability, not power state: a display that's
 * fully powered off will refuse the TCP connection, which is an expected,
 * everyday condition (that's the whole reason `on` uses Wake-on-LAN) rather
 * than a driver fault. `connect()` therefore never throws — a failed initial
 * probe just leaves the driver offline until the display is woken and the
 * watchdog's next Get Power query succeeds.
 */

import { EventEmitter } from "node:events";
import type { Socket } from "bun";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
  errMsg,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";
import {
  buildMagicPacket,
  decodePowerState,
  encodePowerGet,
  encodePowerOff,
  IiyamaFrameDecoder,
  type IiyamaReport,
  isCommCompleted,
  isCommConfirmation,
  isPowerReport,
} from "./iiyama.ts";

type DisplayState = { power?: "on" | "off" | "unknown" };

export class IiyamaProliteDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  // ── config ─────────────────────────────────────────────────
  private host = "";
  private port = 5000;
  private macAddress = "";
  private wolPort = 9;
  private broadcastAddress = "255.255.255.255";
  private monitorId = 1;
  private responseTimeoutMs = 3000;

  // ── runtime ────────────────────────────────────────────────
  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  private state: DisplayState = {};
  private simState: DisplayState = {};

  /** Serialises device I/O — one TCP transaction at a time. */
  private lock: Promise<unknown> = Promise.resolve();

  // ── lifecycle ──────────────────────────────────────────────

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port || 5000;
    this.macAddress = String(config.config.macAddress ?? "");
    this.wolPort = Number(config.config.wolPort ?? 9);
    this.broadcastAddress = String(config.config.broadcastAddress ?? "255.255.255.255");
    this.monitorId = Number(config.config.monitorId ?? 1);
    this.responseTimeoutMs = Number(config.config.responseTimeoutMs ?? 3000);

    if (!this.macAddress) throw new Error("macAddress is required (used for Wake-on-LAN)");

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
    ctx.logger.debug("iiyama-prolite init", { host: this.host, port: this.port, macAddress: this.macAddress });
  }

  /** Best-effort reachability probe (Get Power). A powered-off display failing this is normal. */
  async connect(): Promise<void> {
    if (this.ctx.dryRun) {
      this.online = true;
      this.emit("connected");
      return;
    }
    try {
      await this.queryPower();
    } catch (err) {
      this.ctx.logger.debug("iiyama-prolite initial probe failed (display likely powered off)", {
        error: errMsg(err),
      });
    }
  }

  async disconnect(): Promise<void> {
    this.setOnline(false, "disconnected");
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  // ── status ─────────────────────────────────────────────────

  isConnected(): boolean {
    return this.online;
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    if (this.ctx.dryRun) return { online: true, checkedAt: new Date() };
    try {
      await this.queryPower();
      return { online: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (err) {
      return { online: false, details: errMsg(err), checkedAt: new Date() };
    }
  }

  // ── commands ───────────────────────────────────────────────

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    _params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();

    try {
      if (this.ctx.dryRun) {
        const state = this.applyDryRun(command);
        this.ctx.logger.info("iiyama-prolite dry-run command", { command });
        return { success: true, durationMs: Date.now() - start, state };
      }

      const state = await this.runCommand(command);
      this.state = { ...this.state, ...state };
      this.emit("state", { endpointId: endpoint.id, state, source: "echo", timestamp: new Date() });
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = errMsg(err);
      this.ctx.logger.warn("iiyama-prolite command failed", { command, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  private async runCommand(command: string): Promise<DisplayState> {
    switch (command) {
      case "on":
        await this.wakeOnLan();
        return { power: "on" };
      case "off":
        await this.sendPowerOff();
        return { power: "off" };
      default:
        throw new Error(`unknown command: ${command}`);
    }
  }

  private applyDryRun(command: string): DisplayState {
    switch (command) {
      case "on":
        this.simState.power = "on";
        break;
      case "off":
        this.simState.power = "off";
        break;
      default:
        throw new Error(`unknown command: ${command}`);
    }
    return { ...this.simState };
  }

  // ── readState ──────────────────────────────────────────────

  async readState(endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    if (this.ctx.dryRun) return { ...this.simState };

    const state = await this.queryPower();
    this.emit("state", { endpointId: endpoint.id, state, source: "poll", timestamp: new Date() });
    return { ...this.state };
  }

  // ── power on: Wake-on-LAN ──────────────────────────────────

  /** Send the WoL magic packet. Fire-and-forget — no confirmation is possible. */
  private async wakeOnLan(): Promise<void> {
    const packet = buildMagicPacket(this.macAddress);
    const socket = await Bun.udpSocket({ socket: {} });
    try {
      socket.setBroadcast(true);
      this.ctx.logger.debug("iiyama-prolite wol →", {
        macAddress: this.macAddress,
        broadcastAddress: this.broadcastAddress,
        port: this.wolPort,
      });
      socket.send(packet, this.wolPort, this.broadcastAddress);
    } finally {
      socket.close();
    }
  }

  // ── power off / power query: RS232-over-LAN ───────────────

  /** Send Power Off and wait for the display's Communication Control "Completed" confirmation. */
  private async sendPowerOff(): Promise<void> {
    try {
      const report = await this.transaction(encodePowerOff(this.monitorId), isCommConfirmation);
      if (!isCommCompleted(report)) {
        const status = report.data[1];
        const hex = status !== undefined ? `0x${status.toString(16).padStart(2, "0")}` : "unknown";
        throw new Error(`display did not confirm power off (status ${hex})`);
      }
      this.setOnline(true);
    } catch (err) {
      this.setOnline(false, errMsg(err));
      throw err;
    }
  }

  /** Query current power state (used for readState, healthCheck, and the initial probe). */
  private async queryPower(): Promise<DisplayState> {
    try {
      const report = await this.transaction(encodePowerGet(this.monitorId), isPowerReport);
      const state: DisplayState = { power: decodePowerState(report.data) };
      this.state = { ...this.state, ...state };
      this.setOnline(true);
      return state;
    } catch (err) {
      this.setOnline(false, errMsg(err));
      throw err;
    }
  }

  // ── transaction layer ──────────────────────────────────────

  /** Serialise device I/O so at most one TCP transaction runs at a time. */
  private transaction(frame: Buffer, matches: (report: IiyamaReport) => boolean): Promise<IiyamaReport> {
    const run = this.lock.then(() => this.doTransaction(frame, matches));
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Open a short-lived socket, send one frame, and resolve on the first matching report. */
  private doTransaction(frame: Buffer, matches: (report: IiyamaReport) => boolean): Promise<IiyamaReport> {
    if (this.destroyed) return Promise.reject(new Error("driver destroyed"));

    return new Promise<IiyamaReport>((resolve, reject) => {
      const decoder = new IiyamaFrameDecoder();
      let settled = false;
      let socket: Socket | null = null;

      const timer = setTimeout(() => {
        finish(new Error(`response timeout after ${this.responseTimeoutMs}ms`));
      }, this.responseTimeoutMs);

      const finish = (err: Error | null, report?: IiyamaReport) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket?.end();
        if (err) reject(err);
        else resolve(report!);
      };

      Bun.connect({
        hostname: this.host,
        port: this.port,
        socket: {
          open: (sock) => {
            socket = sock;
            this.ctx.logger.debug("iiyama-prolite tx →", { host: this.host, bytes: frame.toString("hex") });
            sock.write(frame);
          },
          data: (_sock, chunk) => {
            for (const report of decoder.push(chunk)) {
              if (matches(report)) {
                finish(null, report);
                return;
              }
            }
          },
          close: () => finish(new Error("connection closed before a response arrived")),
          end: () => finish(new Error("connection ended before a response arrived")),
          error: (_sock, error) => finish(error instanceof Error ? error : new Error(String(error))),
          connectError: (_sock, error) => finish(error instanceof Error ? error : new Error(String(error))),
        },
      }).catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
    });
  }

  // ── helpers ────────────────────────────────────────────────

  /** Flip the online flag and emit connected/disconnected only on a transition. */
  private setOnline(online: boolean, reason = "unreachable"): void {
    if (this.online === online) return;
    this.online = online;
    if (online) {
      this.ctx.logger.info("iiyama-prolite online", { host: this.host });
      this.emit("connected");
    } else {
      this.ctx.logger.warn("iiyama-prolite offline", { host: this.host, reason });
      this.emit("disconnected", reason);
    }
  }
}
