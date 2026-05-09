import { io } from 'socket.io-client';

const url = import.meta.env.VITE_API_URL ?? window.location.origin;
export const socket = io(url, { autoConnect: true, transports: ['websocket', 'polling'] });
