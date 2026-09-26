import type { WebSocket } from 'ws';

export const PRIVATE_SOCKET_LIFETIME_MS = 5 * 60_000;
const socketsByUser = new Map<string, Set<WebSocket>>();
const socketsByIp = new Map<string, number>();
let totalSockets = 0;

export function protectWebSocket(socket: WebSocket, ip: string): boolean {
  if (totalSockets >= 1_000 || (socketsByIp.get(ip) ?? 0) >= 20) {
    socket.close(1013, 'Connection limit reached');
    return false;
  }
  totalSockets += 1;
  socketsByIp.set(ip, (socketsByIp.get(ip) ?? 0) + 1);
  let windowStart = Date.now();
  let messages = 0;
  let alive = true;
  socket.on('pong', () => { alive = true; });
  socket.on('message', () => {
    const now = Date.now();
    if (now - windowStart >= 1_000) {
      windowStart = now;
      messages = 0;
    }
    if (++messages > 20) socket.terminate();
  });
  const heartbeat = setInterval(() => {
    if (!alive || socket.bufferedAmount > 2 * 1024 * 1024) {
      socket.terminate();
      return;
    }
    alive = false;
    socket.ping();
  }, 30_000);
  heartbeat.unref();
  socket.once('close', () => {
    clearInterval(heartbeat);
    totalSockets -= 1;
    const remaining = (socketsByIp.get(ip) ?? 1) - 1;
    if (remaining === 0) socketsByIp.delete(ip);
    else socketsByIp.set(ip, remaining);
  });
  return true;
}

export function registerPrivateWebSocket(userId: string, socket: WebSocket): void {
  if (socket.readyState !== 1) return;
  const sockets = socketsByUser.get(userId) ?? new Set<WebSocket>();
  sockets.add(socket);
  socketsByUser.set(userId, sockets);
  const expiry = setTimeout(() => socket.terminate(), PRIVATE_SOCKET_LIFETIME_MS);
  expiry.unref();
  socket.once('close', () => {
    clearTimeout(expiry);
    sockets.delete(socket);
    if (sockets.size === 0 && socketsByUser.get(userId) === sockets) socketsByUser.delete(userId);
  });
}

export function revokePrivateWebSockets(userId: string): void {
  const sockets = socketsByUser.get(userId);
  if (!sockets) return;
  socketsByUser.delete(userId);
  for (const socket of sockets) socket.terminate();
}
