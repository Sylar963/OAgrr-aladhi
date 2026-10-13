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

/** Strip the query string before logging: signed venues (Coincall) carry the API key and signature there. */
export function redactWsUrl(url: string): string {
  const queryAt = url.indexOf('?');
  return queryAt < 0 ? url : `${url.slice(0, queryAt)}?<redacted>`;
}
