/**
 * Generic Trigger driver — fire-and-forget message buttons over TCP, UDP, or
 * OSC-over-UDP. See manifest.ts for the full design rationale.
 *
 * Every send is a fresh, ephemeral operation — nothing is kept open between
 * sends, so `connect()`/`healthCheck()` don't open a real socket at all; they
 * always succeed, and a bad host/port/listener surfaces on the send itself as
 * a command failure (see manifest.ts for why a probe would be actively
 * misleading here).
 */

import { EventEmitter } from "node:events";
import {
  type CommandResult,
  type ConnectionConfig,
  type DriverContext,
  type EndpointDescriptor,
  type HealthStatus,
  type IDeviceDriver,
  TcpClient,
  encodeOscMessage,
  parseOscArgs,
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";

const TCP_TYPE = "generic-trigger.tcp";
const UDP_TYPE = "generic-trigger.udp";
const OSC_TYPE = "generic-trigger.osc";

/** Interpret escape sequences in the config-provided delimiter (\r \n \t). */
function unescapeDelimiter(raw: string): string {
  return raw.replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`invalid ${field}: expected a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}

export class GenericTriggerDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private host = "";
  private port = 0;
  private txDelimiter = "\r\n";
  private connectTimeoutMs = 2000;

  private ctx!: DriverContext;
  private destroyed = false;

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port;
    this.txDelimiter = unescapeDelimiter(String(config.config.txDelimiter ?? "\r\n"));
    this.connectTimeoutMs = Number(config.config.responseTimeoutMs ?? 2000);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
  }

  async connect(): Promise<void> {
    this.emit("connected");
  }

  async disconnect(): Promise<void> {
    // No persistent resources to release — every send opens and closes its own socket.
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return !this.destroyed;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { online: !this.destroyed, checkedAt: new Date() };
  }

  async executeCommand(
    endpoint: EndpointDescriptor,
    command: string,
    params: Record<string, unknown>,
  ): Promise<CommandResult> {
    const start = Date.now();
    if (command !== "send") {
      return { success: false, durationMs: 0, error: `unknown command: ${command}` };
    }

    try {
      this.validate(endpoint.type, params);

      if (this.ctx.dryRun) {
        this.ctx.logger.info("generic-trigger dry-run send", { endpointType: endpoint.type, params });
        return { success: true, durationMs: Date.now() - start };
      }

      await this.dispatch(endpoint.type, params);
      return { success: true, durationMs: Date.now() - start };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("generic-trigger send failed", { endpointType: endpoint.type, error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(_endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    // Fire-and-forget — nothing to read back.
    return {};
  }

  // ── validation + dispatch ──────────────────────────────────

  private validate(endpointType: string, params: Record<string, unknown>): void {
    if (endpointType === OSC_TYPE) {
      const address = requireString(params.address, "address");
      if (!address.startsWith("/")) {
        throw new Error(`invalid OSC address: "${address}" (must start with "/")`);
      }
      return;
    }
    if (endpointType === TCP_TYPE || endpointType === UDP_TYPE) {
      requireString(params.payload, "payload");
      return;
    }
    throw new Error(`unknown endpoint type: ${endpointType}`);
  }

  private async dispatch(endpointType: string, params: Record<string, unknown>): Promise<void> {
    switch (endpointType) {
      case TCP_TYPE:
        return this.sendTcp(params);
      case UDP_TYPE:
        return this.sendUdpRaw(params);
      case OSC_TYPE:
        return this.sendOsc(params);
      default:
        throw new Error(`unknown endpoint type: ${endpointType}`);
    }
  }

  // ── transport ──────────────────────────────────────────────

  private async sendTcp(params: Record<string, unknown>): Promise<void> {
    const payload = String(params.payload);
    const appendDelimiter = params.appendDelimiter !== false;
    const text = appendDelimiter ? payload + this.txDelimiter : payload;

    const client = new TcpClient({
      hostname: this.host,
      port: this.port,
      connectTimeoutMs: this.connectTimeoutMs,
    });
    await client.connect();
    this.ctx.logger.debug("generic-trigger tcp tx →", { host: this.host, port: this.port, payload });
    try {
      client.write(text);
    } finally {
      client.close();
    }
  }

  private async sendUdpRaw(params: Record<string, unknown>): Promise<void> {
    await this.sendUdpBytes(new TextEncoder().encode(String(params.payload)));
  }

  private async sendOsc(params: Record<string, unknown>): Promise<void> {
    const address = String(params.address);
    const args = parseOscArgs(params.args as string | undefined);
    await this.sendUdpBytes(encodeOscMessage(address, args));
  }

  private async sendUdpBytes(bytes: Uint8Array): Promise<void> {
    const socket = await Bun.udpSocket({ connect: { hostname: this.host, port: this.port } });
    this.ctx.logger.debug("generic-trigger udp tx →", { host: this.host, port: this.port, bytes: bytes.length });
    try {
      socket.send(bytes);
    } finally {
      socket.close();
    }
  }
}
