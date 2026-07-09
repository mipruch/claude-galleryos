/**
 * In-process raw TCP mock for driver-generic-trigger tests.
 *
 * No protocol awareness needed — this driver only ever connects, writes, and
 * disconnects — so the mock just captures each connection's full received text
 * once it ends, exactly once (guards against both `end` (FIN) and `close`
 * firing for the same graceful disconnect).
 */
import type { Socket, TCPSocketListener } from "bun";

interface ConnState {
  text: string;
  settled: boolean;
}

export interface TcpMockServer {
  port: number;
  stop: () => void;
  /** Every finished connection's received text, in the order they closed. */
  received: () => string[];
}

export function startTcpMock(): TcpMockServer {
  const received: string[] = [];

  function settle(socket: Socket<ConnState>): void {
    if (socket.data.settled) return;
    socket.data.settled = true;
    received.push(socket.data.text);
  }

  const server: TCPSocketListener<ConnState> = Bun.listen<ConnState>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { text: "", settled: false };
      },
      data(socket, chunk) {
        socket.data.text += Buffer.from(chunk).toString("utf-8");
      },
      close: settle,
      end: settle,
    },
  });

  return {
    port: server.port,
    stop: () => server.stop(true),
    received: () => [...received],
  };
}
