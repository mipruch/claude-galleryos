/**
 * Generic configurable TCP driver.
 *
 * Sends raw payloads over TCP and optionally reads one delimited response.
 * Connection mode is configurable: `persistent` keeps a single socket open;
 * otherwise a fresh connection is used per command.
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
} from "@gallery/driver-core";
import { manifest } from "./manifest.ts";

/** Interpret escape sequences in config-provided delimiters (\r \n \t). */
function unescapeDelimiter(raw: string): string {
  return raw.replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

export class TcpGenericDriver extends EventEmitter implements IDeviceDriver {
  readonly manifest = manifest;

  private host = "";
  private port = 0;
  private txDelimiter = "\r\n";
  private rxDelimiter = "\r\n";
  private encoding: BufferEncoding = "utf-8";
  private timeoutMs = 2000;
  private persistent = false;

  private ctx!: DriverContext;
  private online = false;
  private destroyed = false;
  private client: TcpClient | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  async init(config: ConnectionConfig, ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
    this.host = config.host;
    this.port = config.port;
    this.txDelimiter = unescapeDelimiter(String(config.config.txDelimiter ?? "\r\n"));
    this.rxDelimiter = unescapeDelimiter(String(config.config.rxDelimiter ?? "\r\n"));
    this.encoding = (config.config.encoding as BufferEncoding) ?? "utf-8";
    this.timeoutMs = Number(config.config.responseTimeoutMs ?? 2000);
    this.persistent = Boolean(config.config.persistent ?? false);

    ctx.signal.addEventListener("abort", () => {
      this.destroyed = true;
    });
  }

  async connect(): Promise<void> {
    try {
      if (this.persistent) {
        await this.ensureClient();
      } else {
        const probe = this.newClient();
        await probe.connect();
        probe.close();
      }
      this.online = true;
      this.emit("connected");
    } catch (err) {
      this.online = false;
      const reason = err instanceof Error ? err.message : String(err);
      this.emit("disconnected", reason);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.online = false;
    this.client?.close();
    this.client = null;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.disconnect();
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.online;
  }

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      if (this.persistent) {
        await this.ensureClient();
      } else {
        const probe = this.newClient();
        await probe.connect();
        probe.close();
      }
      this.online = true;
      return { online: true, latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (err) {
      this.online = false;
      return {
        online: false,
        details: err instanceof Error ? err.message : String(err),
        checkedAt: new Date(),
      };
    }
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

    const payload = String(params.payload ?? "");
    const expectResponse = Boolean(params.expectResponse ?? false);
    const appendDelimiter = params.appendDelimiter !== false;

    if (this.ctx.dryRun) {
      this.ctx.logger.info("tcp-generic dry-run send", { payload, expectResponse });
      return { success: true, durationMs: Date.now() - start };
    }

    try {
      const response = await this.send(payload, expectResponse, appendDelimiter);
      this.online = true;
      const state = response !== undefined ? { lastResponse: response } : undefined;
      if (state) {
        this.emit("state", {
          endpointId: endpoint.id,
          state,
          source: "echo",
          timestamp: new Date(),
        });
      }
      return { success: true, durationMs: Date.now() - start, state };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.ctx.logger.warn("tcp-generic send failed", { error: message });
      return { success: false, durationMs: Date.now() - start, error: message };
    }
  }

  async readState(_endpoint: EndpointDescriptor): Promise<Record<string, unknown>> {
    // Generic devices have no queryable state model.
    return {};
  }

  // ── transport ──────────────────────────────────────────────

  /** Send a payload (serialised), optionally returning one response frame. */
  private send(
    payload: string,
    expectResponse: boolean,
    appendDelimiter: boolean,
  ): Promise<string | undefined> {
    const run = this.lock.then(() => this.doSend(payload, expectResponse, appendDelimiter));
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doSend(
    payload: string,
    expectResponse: boolean,
    appendDelimiter: boolean,
  ): Promise<string | undefined> {
    if (this.destroyed) throw new Error("driver destroyed");

    const client = this.persistent ? await this.ensureClient() : this.newClient();
    if (!this.persistent) await client.connect();

    // Log the raw protocol message sent to the physical device.
    this.ctx.logger.debug("tcp tx →", { host: this.host, port: this.port, payload, expectResponse });
    try {
      if (expectResponse) {
        const response = client.receive(this.timeoutMs);
        appendDelimiter ? client.sendLine(payload) : client.write(payload);
        const frame = await response;
        this.ctx.logger.debug("tcp rx ←", { host: this.host, response: frame });
        return frame;
      }
      appendDelimiter ? client.sendLine(payload) : client.write(payload);
      return undefined;
    } finally {
      if (!this.persistent) client.close();
    }
  }

  private newClient(): TcpClient {
    return new TcpClient({
      hostname: this.host,
      port: this.port,
      rxDelimiter: this.rxDelimiter,
      txDelimiter: this.txDelimiter,
      encoding: this.encoding,
      connectTimeoutMs: this.timeoutMs,
    });
  }

  /** Return the persistent client, (re)connecting if necessary. */
  private async ensureClient(): Promise<TcpClient> {
    if (this.client?.isConnected()) return this.client;
    const client = this.newClient();
    client.onClose = () => {
      if (this.client === client) this.client = null;
    };
    await client.connect();
    this.client = client;
    return client;
  }
}
