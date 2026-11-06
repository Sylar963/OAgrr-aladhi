import { FlowEvidenceQuerySchema, FlowEvidenceResponseSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { flowEvidenceService, flowOiStore } from '../services.js';
import { protectWebSocket } from '../websocket-security.js';

const WS_OPEN = 1;

export async function wsFlowEvidenceRoute(app: FastifyInstance) {
  app.get('/ws/flow-evidence', { websocket: true }, async (socket, req) => {
    if (!protectWebSocket(socket, req.ip)) return;
    const query = FlowEvidenceQuerySchema.safeParse(req.query);
    if (!query.success) {
      send(socket, { type: 'error', code: 'INVALID_QUERY' });
      socket.close(1008, 'Invalid query');
      return;
    }

    let closed = false;
    let initializing = true;
    let buffered = false;
    let publishing = false;
    let dirty = false;
    let current: Awaited<ReturnType<typeof flowEvidenceService.get>> = null;
    const unsubscribe = flowOiStore.subscribe((tick) => {
      if (tick.venue !== query.data.venue) return;
      if (initializing) {
        buffered = true;
        return;
      }
      if (
        tick.instrument !== query.data.instrument &&
        !current?.analysis.legs.some((leg) => leg.instrument === tick.instrument)
      )
        return;
      void publish().catch((error: unknown) => {
        req.log.warn({ err: String(error) }, 'FLOW evidence push failed');
      });
    });
    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
    };
    socket.once('close', cleanup);

    const publish = async () => {
      if (closed) return;
      if (publishing) {
        dirty = true;
        return;
      }
      publishing = true;
      try {
        do {
          dirty = false;
          const result = await flowEvidenceService.get(query.data);
          if (closed || !result) return;
          current = result;
          send(socket, { type: 'evidence', evidence: FlowEvidenceResponseSchema.parse(result) });
        } while (dirty && !closed);
      } finally {
        publishing = false;
      }
    };

    try {
      await publish();
      initializing = false;
      if (buffered) void publish();
    } catch (error: unknown) {
      req.log.warn({ err: String(error) }, 'FLOW evidence stream failed');
      cleanup();
      socket.close(1011, 'Stream failed');
    }
  });
}

function send(socket: { readyState: number; send: (data: string) => void }, message: unknown): void {
  if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(message));
}
