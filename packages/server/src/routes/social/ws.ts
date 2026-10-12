import { ChatClientMessageSchema, type ChatServerMessage } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import {
  broadcastRegistry,
  chatService,
  isSocialEnabled,
  socialProfileService,
  traderStreamService,
} from '../../social-services.js';
import { protectWebSocket, registerPrivateWebSocket } from '../../websocket-security.js';
import { consumeWebSocketTicket } from '../../websocket-ticket-service.js';

const WS_OPEN = 1;

const ERROR_MESSAGES: Record<string, string> = {
  banned: 'You are banned from chat',
  muted: 'You are muted',
  handle_required: 'Set a username on your account to post under your name',
  rate_limited: 'Slow down',
  chat_busy: 'Chat is busy, try again shortly',
  not_found: 'Message not found',
  forbidden: 'Not allowed',
};

export async function socialWsRoute(app: FastifyInstance) {
  app.get('/ws/social', { websocket: true }, async (socket, req) => {
    if (!protectWebSocket(socket, req.ip)) return;
    const send = (msg: ChatServerMessage) => {
      if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(msg));
    };
    const reject = (code: string, message: string) => {
      send({ type: 'error', code, message });
      socket.close(1008, code);
    };

    if (!isSocialEnabled()) {
      reject('unavailable', 'Social features need DATABASE_URL');
      return;
    }
    const ticket = new URL(req.url, 'http://localhost').searchParams.get('ticket');
    const user = consumeWebSocketTicket(ticket);
    if (!user) {
      reject('unauthorized', 'Invalid or expired WebSocket ticket');
      return;
    }
    registerPrivateWebSocket(user.id, socket);

    const viewer = { userId: user.id, send };
    let unsubscribe: (() => void) | null = null;
    let closed = false;
    socket.on('close', () => {
      closed = true;
      unsubscribe?.();
      traderStreamService.unwatch(viewer);
    });

    socket.on('message', (raw: Buffer) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        send({ type: 'error', code: 'invalid_message', message: 'Malformed JSON' });
        return;
      }
      const parsed = ChatClientMessageSchema.safeParse(payload);
      if (!parsed.success) {
        send({ type: 'error', code: 'invalid_message', message: 'Invalid chat message' });
        return;
      }
      void handle(parsed.data).catch((err: unknown) => {
        req.log.warn({ err: String(err) }, 'social chat message failed');
        send({ type: 'error', code: 'internal_error', message: 'Message failed' });
      });
    });

    async function handle(message: ReturnType<typeof ChatClientMessageSchema.parse>) {
      if (message.type === 'send') {
        const profile = await socialProfileService.get(user!.id);
        const result = await chatService.post(user!.id, profile.handle, message);
        if (!result.ok) {
          send({ type: 'error', code: result.error, message: ERROR_MESSAGES[result.error] ?? '' });
        }
        return;
      }
      if (message.type === 'delete') {
        const error = await chatService.deleteOwn(user!.id, message.id);
        if (error) send({ type: 'error', code: error, message: ERROR_MESSAGES[error] ?? '' });
        return;
      }
      if (message.type === 'unwatch') {
        traderStreamService.unwatch(viewer);
        return;
      }
      const found = await broadcastRegistry.find(message.handle);
      if (closed) return;
      if (!found) {
        traderStreamService.unwatch(viewer);
        send({ type: 'trader_unavailable', handle: message.handle, reason: 'left' });
        return;
      }
      await traderStreamService.watch(viewer, found.broadcaster);
      if (closed) traderStreamService.unwatch(viewer);
    }

    try {
      const profile = await socialProfileService.get(user.id);
      if (closed) return;
      unsubscribe = await chatService.subscribe(viewer, profile.handle);
      if (closed) unsubscribe();
    } catch (err) {
      req.log.warn({ err: String(err) }, 'social chat subscribe failed');
      reject('internal_error', 'Chat unavailable');
    }
  });
}
