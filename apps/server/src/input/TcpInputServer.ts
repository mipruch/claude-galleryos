import { createServer, Server } from 'net';
import { config as appConfig } from '../config.js';
import { childLogger } from '../logger.js';
import { eventBus } from '../core/EventBus.js';
import { dispatchTcp } from './InputMapper.js';

const log = childLogger('tcp_input');

let server: Server | null = null;

export function startTcpInputServer(): void {
  server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const client = `${socket.remoteAddress}:${socket.remotePort}`;
        eventBus.emit('event', { type: 'input.tcp.received', message: line, client });
        void dispatchTcp(line);
      }
    });
    socket.on('error', () => socket.destroy());
  });
  server.listen(appConfig.tcpInputPort, () => {
    log.info('TCP input server listening', { port: appConfig.tcpInputPort });
  });
}

export function stopTcpInputServer(): void {
  server?.close();
  server = null;
}
