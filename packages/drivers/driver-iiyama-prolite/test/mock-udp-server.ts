/**
 * In-process UDP mock for driver-iiyama-prolite tests. Binds a local UDP
 * socket and records every datagram it receives — used to inspect the
 * Wake-on-LAN magic packet without touching a real network broadcast.
 */

export interface UdpDatagram {
  bytes: Uint8Array;
  fromPort: number;
  fromAddress: string;
}

export interface UdpMockServer {
  port: number;
  stop: () => void;
  received: () => UdpDatagram[];
}

export async function startUdpMock(): Promise<UdpMockServer> {
  const received: UdpDatagram[] = [];

  const server = await Bun.udpSocket({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(_socket, buf, fromPort, fromAddress) {
        received.push({ bytes: new Uint8Array(buf), fromPort, fromAddress });
      },
    },
  });

  return {
    port: server.port,
    stop: () => server.close(),
    received: () => [...received],
  };
}
