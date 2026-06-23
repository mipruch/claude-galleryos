/**
 * In-process mock TCP devices for driver tests (Bun.listen).
 *
 * - {@link startPjlinkMock} speaks enough of the PJLink Class 1 protocol
 *   (banner, optional auth, POWR/INPT/AVMT) and closes after each command, like
 *   a real projector.
 * - {@link startEchoMock} echoes any newline-framed line back as `ECHO:<line>`.
 */

import type { Socket, TCPSocketListener } from "bun";

export interface MockServer {
  port: number;
  stop: () => void;
}

export interface PjlinkMockServer extends MockServer {
  /** Current device state, for assertions. */
  state: () => { power: string; input: string; avmt: string };
}

interface PjlinkConn {
  buf: string;
  authed: boolean;
  seed: string;
}

/** Start a mock PJLink projector. Pass a password to require authentication. */
export function startPjlinkMock(
  opts: { password?: string; bannerDelayMs?: number } = {},
): PjlinkMockServer {
  const password = opts.password;
  const bannerDelayMs = opts.bannerDelayMs ?? 0;
  const state = { power: "0", input: "31", avmt: "30" };
  const conns = new WeakMap<Socket<PjlinkConn>, PjlinkConn>();

  const server: TCPSocketListener<PjlinkConn> = Bun.listen<PjlinkConn>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        const seed = "12345678"; // fixed seed keeps the test deterministic
        const conn: PjlinkConn = { buf: "", authed: !password, seed };
        conns.set(socket, conn);
        const banner = password ? `PJLINK 1 ${seed}\r` : "PJLINK 0\r";
        // Optionally stall the auth banner to exercise the driver's total
        // transaction deadline (a sluggish projector after socket accept).
        if (bannerDelayMs > 0) setTimeout(() => socket.write(banner), bannerDelayMs);
        else socket.write(banner);
      },
      data(socket, data) {
        const conn = conns.get(socket);
        if (!conn) return;
        conn.buf += Buffer.from(data).toString("latin1");
        let idx: number;
        while ((idx = conn.buf.indexOf("\r")) !== -1) {
          let line = conn.buf.slice(0, idx);
          conn.buf = conn.buf.slice(idx + 1);

          if (password && !conn.authed) {
            const m = line.match(/^([0-9a-f]{32})(%.*)$/);
            const expected = new Bun.CryptoHasher("md5")
              .update(conn.seed + password)
              .digest("hex");
            if (!m || m[1] !== expected) {
              socket.write("PJLINK ERRA\r");
              socket.end();
              return;
            }
            conn.authed = true;
            line = m[2]!;
          }

          socket.write(handlePjlink(line, state) + "\r");
          socket.end(); // projectors close the socket after each command
        }
      },
    },
  });

  return { port: server.port, stop: () => server.stop(), state: () => ({ ...state }) };
}

function handlePjlink(cmd: string, state: { power: string; input: string; avmt: string }): string {
  const c = cmd.trim();
  if (c === "%1POWR ?") return `%1POWR=${state.power}`;
  if (c === "%1POWR 1") return (state.power = "1"), "%1POWR=OK";
  if (c === "%1POWR 0") return (state.power = "0"), "%1POWR=OK";
  if (c === "%1INPT ?") return `%1INPT=${state.input}`;
  if (c.startsWith("%1INPT ")) return (state.input = c.slice(7)), "%1INPT=OK";
  if (c === "%1AVMT ?") return `%1AVMT=${state.avmt}`;
  if (c.startsWith("%1AVMT ")) return (state.avmt = c.slice(7)), "%1AVMT=OK";
  return `%1${c.slice(1, 5)}=ERR1`;
}

/** Start a mock newline-framed echo server. */
export function startEchoMock(): MockServer {
  const conns = new WeakMap<Socket<{ buf: string }>, { buf: string }>();
  const server = Bun.listen<{ buf: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        conns.set(socket, { buf: "" });
      },
      data(socket, data) {
        const conn = conns.get(socket);
        if (!conn) return;
        conn.buf += Buffer.from(data).toString("utf8");
        let idx: number;
        while ((idx = conn.buf.indexOf("\n")) !== -1) {
          const line = conn.buf.slice(0, idx);
          conn.buf = conn.buf.slice(idx + 1);
          socket.write(`ECHO:${line}\n`);
        }
      },
    },
  });
  return { port: server.port, stop: () => server.stop() };
}
