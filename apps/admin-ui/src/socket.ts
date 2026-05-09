import { io, type Socket } from 'socket.io-client';

const url = import.meta.env.VITE_API_URL ?? window.location.origin;

export const socket: Socket = io(url, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

export function connectSocket(): void {
  if (!socket.connected) socket.connect();
}
