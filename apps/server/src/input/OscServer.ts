import * as osc from 'node-osc';
import { config as appConfig } from '../config.js';
import { childLogger } from '../logger.js';
import { eventBus } from '../core/EventBus.js';
import { dispatchOsc } from './InputMapper.js';

const log = childLogger('osc_input');

let server: osc.Server | null = null;

export function startOscServer(): void {
  server = new osc.Server(appConfig.oscPort, '0.0.0.0', () => {
    log.info('OSC server listening', { port: appConfig.oscPort });
  });
  server.on('message', (msg: any[]) => {
    const [address, ...args] = msg;
    eventBus.emit('event', { type: 'input.osc.received', address, args });
    void dispatchOsc(String(address), args);
  });
  server.on('error', (err: Error) => log.warn('OSC error', { error: err.message }));
}

export function stopOscServer(): void {
  server?.close();
  server = null;
}
