import websocket from '@fastify/websocket';
import { NewsDeliveryJournal } from '@oggregator/core';
import { NewsEventsResponseSchema, NewsStreamMessageSchema } from '@oggregator/protocol';
import Fastify from 'fastify';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ journal: null as NewsDeliveryJournal | null }));
vi.mock('../services.js', () => ({
  get newsDelivery() {
    return state.journal;
  },
  newsService: null,
}));
import { newsEventsRoute, wsNewsEventsRoute } from './news-events.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
function setup() {
  state.journal = new NewsDeliveryJournal({ read: () => [], append: () => {}, replace: () => {} });
  const app = Fastify();
  apps.push(app);
  return { app, journal: state.journal };
}
function record(journal: NewsDeliveryJournal, id: string, timestamp: number) {
  journal.record([
    {
      id,
      timestamp,
      text: id,
      source: 'test',
      url: '',
      handle: null,
      ruleTag: null,
      classification: 'unclassified',
      upstreamCreatedAt: null,
    },
  ]);
}

describe('external bot news delivery', () => {
  it('pages by arrival cursor and returns an explicit resync response', async () => {
    const { app, journal } = setup();
    await app.register(newsEventsRoute);
    record(journal, 'new', 100);
    const cursor = journal.cursor;
    record(journal, 'late', 1);
    const response = await app.inject(`/news/events?after=${encodeURIComponent(cursor)}`);
    expect(response.headers['cache-control']).toBe('no-store');
    const page = NewsEventsResponseSchema.parse(response.json());
    expect(page.events.map((event) => event.observation.id)).toEqual(['late']);
    expect((await app.inject('/news/events?after=abc:1')).statusCode).toBe(409);
    expect((await app.inject('/news/events?after=invalid')).statusCode).toBe(400);
    expect((await app.inject('/news/events?limit=1.5')).statusCode).toBe(400);
  });

  it('replays missed events over a public websocket with the same cursors', async () => {
    const { app, journal } = setup();
    const cursor = journal.cursor;
    record(journal, 'a', 1);
    await app.register(websocket);
    await app.register(wsNewsEventsRoute);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const socket = new WebSocket(
      `${address.replace('http', 'ws')}/ws/news?after=${encodeURIComponent(cursor)}`,
    );
    const messages = await new Promise<unknown[]>((resolve, reject) => {
      const received: unknown[] = [];
      const timer = setTimeout(() => reject(new Error('news stream timeout')), 2000);
      socket.on('error', reject);
      socket.on('message', (raw) => {
        received.push(NewsStreamMessageSchema.parse(JSON.parse(raw.toString())));
        if (received.length === 2) {
          clearTimeout(timer);
          resolve(received);
        }
      });
    });
    expect(messages[0]).toMatchObject({ type: 'subscribed', cursor });
    expect(messages[1]).toMatchObject({
      type: 'events',
      page: { events: [{ cursor: journal.cursor }] },
    });
    await new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close();
    });
  });
});
