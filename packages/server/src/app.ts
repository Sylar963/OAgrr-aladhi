import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes/index.js';
import { bootstrapAdapters } from './adapters.js';

let ready = false;

export function isReady() {
  return ready;
}

const isDev = process.env['NODE_ENV'] !== 'production';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        }
      : true,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  registerRoutes(app);

  // Fire-and-forget: server starts accepting requests immediately (returning 503
  // via isReady() guard) while adapters load in the background (~5-15s).
  bootstrapAdapters(app.log).then(() => {
    ready = true;
  });

  return app;
}
