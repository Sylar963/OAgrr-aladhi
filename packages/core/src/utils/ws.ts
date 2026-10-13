import type WebSocket from 'ws';

function ignoreSocketError(): void {}

/**
 * Detach every listener and close the socket without risking an unhandled 'error'.
 * Closing a socket that is still CONNECTING makes `ws` emit 'error' on the next tick;
 * with no listener left that error is thrown and takes the whole process down.
 */
export function closeSocketQuietly(socket: WebSocket): void {
  socket.removeAllListeners();
  socket.on('error', ignoreSocketError);
  socket.close();
}
