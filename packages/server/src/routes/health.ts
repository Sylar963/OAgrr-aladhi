import type { FastifyInstance } from 'fastify';
import { getRegisteredVenues } from '@oggregator/core';
import { isReady } from '../app.js';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: isReady() ? 'ok' : 'initializing',
    venues: getRegisteredVenues(),
    ts: Date.now(),
  }));
}
