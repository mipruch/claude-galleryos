/**
 * In-process mock of an Extron matrix switcher for tests.
 *
 * Speaks a representative subset of the SIS protocol over a Bun.listen TCP
 * socket: tie commands (`{in}*{out}!|%|$`), input queries (`{out}!|%|$`), an
 * optional `Password:` handshake, and `E##` errors for out-of-range values. It
 * stores per-output video/audio routing and can be poked to simulate an
 * unsolicited front-panel tie change.
 */

import type { Socket, TCPSocketListener } from "bun";

export interface ExtronMockOptions {
  inputs?: number;
  outputs?: number;
  /** When set, the device demands this password before accepting commands. */
  password?: string;
}

export interface ExtronMockServer {
  port: number;
  stop: () => void;
  /** Current video input tied to an output (0 if untied). */
  videoOf: (output: number) => number;
  /** Current audio input tied to an output (0 if untied). */
  audioOf: (output: number) => number;
  /** All raw command lines received, in order. */
  received: () => string[];
  /** Simulate a front-panel change: push an unsolicited tie to all clients. */
  pushTie: (input: number, output: number, type: "All" | "Vid" | "Aud") => void;
}

interface Conn {
  buffer: string;
  authed: boolean;
}

const SYMBOL_TYPE: Record<string, "All" | "Vid" | "Aud"> = {
  "!": "All",
  "%": "Vid",
  $: "Aud",
};

export function startExtronMock(opts: ExtronMockOptions = {}): ExtronMockServer {
  const inputs = opts.inputs ?? 10;
  const outputs = opts.outputs ?? 8;
  const password = opts.password ?? "";

  const video = new Map<number, number>();
  const audio = new Map<number, number>();
  const receivedLines: string[] = [];
  const sockets = new Set<Socket<Conn>>();

  function reply(socket: Socket<Conn>, line: string): void {
    socket.write(line + "\r\n");
  }

  function applyTie(input: number, output: number, type: "All" | "Vid" | "Aud"): void {
    if (type !== "Aud") video.set(output, input);
    if (type !== "Vid") audio.set(output, input);
  }

  function handleLine(socket: Socket<Conn>, raw: string): void {
    const line = raw.trim();
    if (line.length === 0) return;
    receivedLines.push(line);

    // Password handshake.
    if (password && !socket.data.authed) {
      if (line === password) {
        socket.data.authed = true;
        reply(socket, "Login Administrator");
      }
      return;
    }

    // Tie: {in}*{out}{sym}
    const tie = /^(\d+)\*(\d+)([!%$])$/.exec(line);
    if (tie) {
      const input = Number(tie[1]);
      const output = Number(tie[2]);
      const type = SYMBOL_TYPE[tie[3]!]!;
      if (input < 0 || input > inputs) return reply(socket, "E01");
      if (output < 1 || output > outputs) return reply(socket, "E12");
      applyTie(input, output, type);
      reply(socket, `Out${pad(output)} In${pad(input)} ${type}`);
      return;
    }

    // Query: {out}{sym}
    const query = /^(\d+)([!%$])$/.exec(line);
    if (query) {
      const output = Number(query[1]);
      const sym = query[2]!;
      if (output < 1 || output > outputs) return reply(socket, "E12");
      const value = sym === "$" ? (audio.get(output) ?? 0) : (video.get(output) ?? 0);
      reply(socket, `In${pad(value)}`);
      return;
    }

    reply(socket, "E10"); // unrecognized command
  }

  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: "", authed: !password };
        sockets.add(socket);
        if (password) socket.write("Password:\r\n");
      },
      close(socket) {
        sockets.delete(socket);
      },
      data(socket, chunk) {
        socket.data.buffer += Buffer.from(chunk).toString("latin1");
        const parts = socket.data.buffer.split(/\r\n|\r|\n/);
        socket.data.buffer = parts.pop() ?? "";
        for (const part of parts) handleLine(socket, part);
      },
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(true),
    videoOf: (output) => video.get(output) ?? 0,
    audioOf: (output) => audio.get(output) ?? 0,
    received: () => [...receivedLines],
    pushTie: (input, output, type) => {
      applyTie(input, output, type);
      for (const s of sockets) s.write(`Out${pad(output)} In${pad(input)} ${type}\r\n`);
    },
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
