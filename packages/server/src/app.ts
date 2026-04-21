import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { registerRoutes } from './routes/index.js';
import { bootstrapAdapters, disposeAdapters } from './adapters.js';
import {
  blockFlowService,
  bootstrapServices,
  dvolService,
  flowService,
  spotService,
  tradeStore,
} from './services.js';
import { paperTradingStore } from './trading-services.js';

let ready = false;
let shuttingDown = false;

export function isReady() {
  return ready && !shuttingDown;
}

export function isShuttingDown() {
  return shuttingDown;
}

export function startShutdown() {
  shuttingDown = true;
  ready = false;
}

const isDev = process.env['NODE_ENV'] !== 'production';

export async function buildApp(): Promise<FastifyInstance> {
  shuttingDown = false;
  ready = false;

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

  await app.register(cors, {
    origin: isDev
      ? true
      : [
          'http://localhost:5173',
          'https://oggregator.xyz',
          'https://www.oggregator.xyz',
          /\.vercel\.app$/,
        ],
    credentials: false,
  });
  await app.register(websocket);

  registerRoutes(app);

  // Tracked so onClose can await any in-flight bootstrap before disposing —
  // otherwise SIGTERM arriving mid-bootstrap would start runtimes that nobody
  // shuts down, leaving WS reconnect loops alive until forceExitTimer fires.
  let bootstrap: Promise<void> = Promise.resolve();

  app.addHook('onClose', async () => {
    // Wait for bootstrap to finish (or fail) so all runtimes that will ever
    // exist are visible before we dispose them.
    await bootstrap.catch(() => {});
    // Stop runtimes first: dispose() flips shouldReconnect=false, clears
    // timers, and closes sockets. If we did this after disposeAdapters(),
    // the runtimes' ws.on('close') handlers would reschedule reconnects.
    flowService.dispose();
    blockFlowService.dispose();
    spotService.dispose();
    dvolService.dispose();
    await disposeAdapters(app.log);
    await tradeStore.dispose();
    await paperTradingStore.dispose();
  });

  // Serve the built web SPA in production (single-service deploy)
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, '../../web/dist');
  if (!isDev && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((_req, reply) => {
      return reply.sendFile('index.html');
    });
  }

  bootstrap = bootstrapAdapters(app.log).then(async () => {
    if (shuttingDown) return;
    ready = true;
    try {
      await bootstrapServices(app.log);
    } catch (err: unknown) {
      app.log.warn({ err: String(err) }, 'services bootstrap failed');
    }
  });

  return app;
}
