// Socket.io client singleton.
// Connects on demand once we have a valid access token; reconnects with a new
// token after refresh.

import { io } from 'socket.io-client';
import { getAccessToken, onAuthChange } from './api.js';

let socket = null;
const SUBS = new Set();

function publish(event) {
  for (const fn of SUBS) {
    try { fn(event); } catch {}
  }
}

function ensureConnected() {
  const token = getAccessToken();
  if (!token) return null;
  if (socket && socket.connected && socket.auth?.token === token) return socket;
  if (socket) socket.disconnect();
  socket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  socket.on('connect', () => publish({ type: 'connect' }));
  socket.on('disconnect', () => publish({ type: 'disconnect' }));
  // Generic forwarder: any server-emitted event becomes a published event
  socket.onAny((kind, payload) => publish({ type: 'event', kind, payload }));
  return socket;
}

// Reconnect when access token rotates (signin / signout / refresh)
onAuthChange(() => {
  if (getAccessToken()) ensureConnected();
  else if (socket) { socket.disconnect(); socket = null; }
});

// Subscribe to ALL socket events. The callback receives:
//   { type: 'connect' | 'disconnect' }
//   { type: 'event', kind: string, payload: any }
export function subscribeSocket(fn) {
  SUBS.add(fn);
  ensureConnected();
  return () => { SUBS.delete(fn); };
}

export function emit(kind, payload) {
  ensureConnected();
  if (socket?.connected) socket.emit(kind, payload);
  else if (socket) socket.once('connect', () => socket.emit(kind, payload));
}

// Current socket id, or null if not connected. The API client attaches this
// to mutation requests so the server can echo-skip just THIS tab — other
// tabs of the same user still receive the broadcast.
export function getSocketId() {
  return socket?.id || null;
}
