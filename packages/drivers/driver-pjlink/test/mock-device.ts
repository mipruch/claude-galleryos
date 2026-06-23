/**
 * In-process mock of a PJLink Class 1 projector for tests.
 *
 * Speaks a representative subset of the protocol over a Bun.listen TCP socket:
 *  - sends the auth banner on connect (`PJLINK 0` or `PJLINK 1 <seed>`),
 *  - validates the `md5(seed + password)` digest prefix when auth is enabled
 *    (answering `PJLINK ERRA` and closing on a bad/missing digest),
 *  - answers POWR/INPT/AVMT/ERST queries and POWR/INPT/AVMT sets,
 *  - returns `ERR3` for INPT/AVMT while powered off (as real projectors do).
 *
 * It records every command line received so tests can assert what was sent
 * (e.g. that the digest prefix was present).
 */

import type { Socket, TCPSocketListener } from "bun";

export interface PjlinkMockOptions {
  /** When set, the projector requires `md5(seed + password)` auth. */
  password?: string;
  /** Initial power state: "0" off, "1" on, "2" cooling, "3" warming. */
  power?: string;
  /** ERST value the projector reports (6 digits). Default no errors. */
  erst?: string;
  /** Fixed 8-hex auth seed (for deterministic digest assertions). */
  seed?: string;
}

export interface PjlinkMockServer {
  port: number;
  stop: () => void;
  /** Current power state digit. */
  power: () => string;
  /** Current input code. */
  input: () => string;
  /** Current AVMT value. */
  avmt: () => string;
  /** All raw command lines received (digest prefix included), in order. */
  received: () => string[];
  /** Number of TCP connections opened so far. */
  connections: () => number;
}

interface Conn {
  buffer: string;
  authed: boolean;
}

export function startPjlinkMock(opts: PjlinkMockOptions = {}): PjlinkMockServer {
  const password = opts.password ?? "";
  const seed = opts.seed ?? "12345678";
  const erst = opts.erst ?? "000000";
  const expectedDigest = password
    ? new Bun.CryptoHasher("md5").update(seed + password).digest("hex")
    : "";

  let power = opts.power ?? "1";
  let input = "31";
  let avmt = "30";
  const receivedLines: string[] = [];
  let connectionCount = 0;

  function reply(socket: Socket<Conn>, line: string): void {
    socket.write(line + "\r");
  }

  function handleLine(socket: Socket<Conn>, raw: string): void {
    const line = raw.replace(/\0/g, "").trim();
    if (line.length === 0) return;
    receivedLines.push(line);

    // Strip an optional 32-hex auth digest prefix.
    const match = /^([0-9a-f]{32})?(%.*)$/i.exec(line);
    if (!match) return;
    const digest = match[1];
    const command = match[2]!;

    if (password && !socket.data.authed) {
      if (digest && digest.toLowerCase() === expectedDigest) {
        socket.data.authed = true;
      } else {
        reply(socket, "PJLINK ERRA");
        socket.end();
        return;
      }
    }

    const cmd = /^%(\d)([A-Za-z]{4})\s+(.+)$/.exec(command);
    if (!cmd) return reply(socket, command.slice(0, 6) + "=ERR1");
    const name = cmd[2]!.toUpperCase();
    const arg = cmd[3]!.trim();
    const head = `%1${name}`;

    if (arg === "?") {
      switch (name) {
        case "POWR": return reply(socket, `${head}=${power}`);
        case "INPT": return reply(socket, power === "1" ? `${head}=${input}` : `${head}=ERR3`);
        case "AVMT": return reply(socket, power === "1" ? `${head}=${avmt}` : `${head}=ERR3`);
        case "ERST": return reply(socket, `${head}=${erst}`);
        default: return reply(socket, `${head}=ERR1`);
      }
    }

    // Set commands.
    switch (name) {
      case "POWR":
        if (arg === "1" || arg === "0") { power = arg; return reply(socket, `${head}=OK`); }
        return reply(socket, `${head}=ERR2`);
      case "INPT":
        if (/^[1-9][0-9A-Z]$/.test(arg)) { input = arg; return reply(socket, `${head}=OK`); }
        return reply(socket, `${head}=ERR2`);
      case "AVMT":
        if (/^[1-3][01]$/.test(arg)) { avmt = arg; return reply(socket, `${head}=OK`); }
        return reply(socket, `${head}=ERR2`);
      default:
        return reply(socket, `${head}=ERR1`);
    }
  }

  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: "", authed: !password };
        connectionCount += 1;
        // Banner is sent the instant the socket opens.
        socket.write(password ? `PJLINK 1 ${seed}\r` : "PJLINK 0\r");
      },
      data(socket, chunk) {
        socket.data.buffer += Buffer.from(chunk).toString("latin1");
        let idx: number;
        while ((idx = socket.data.buffer.indexOf("\r")) !== -1) {
          const part = socket.data.buffer.slice(0, idx);
          socket.data.buffer = socket.data.buffer.slice(idx + 1);
          handleLine(socket, part);
        }
      },
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(true),
    power: () => power,
    input: () => input,
    avmt: () => avmt,
    received: () => [...receivedLines],
    connections: () => connectionCount,
  };
}
