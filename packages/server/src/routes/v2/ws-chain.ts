import type { FastifyInstance } from 'fastify';

/**
 * v2 WebSocket — listed-options live chain stream.
 *
 * Skeleton only. Sends a hello frame and closes. The live wire-up will mirror
 * `ws-chain.ts` (200ms coalesced snapshot push) but read from the tradfi
 * QuoteStore + DXLink delta stream.
 */
export async function v2WsChainRoute(app: FastifyInstance) {
  app.get('/ws/v2/chain', { websocket: true }, (socket /* WebSocket */, _req) => {
    socket.send(
      JSON.stringify({
        type: 'hello',
        version: 'v2',
        message: 'tradfi chain stream not yet wired',
      }),
    );
    socket.close();
  });
}
