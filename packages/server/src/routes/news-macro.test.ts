import Fastify from 'fastify';
import { NewsMacroResponseSchema } from '@oggregator/protocol';
import { NewsCursorError } from '@oggregator/core';
import { describe, expect, it, vi } from 'vitest';
const { page } = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock('../services.js', () => ({ newsDelivery: { page, cursor: 'abc:2' } }));
import { newsMacroRoute } from './news-macro.js';

describe('macro values from existing news observations', () => {
  it('returns only supported headline observations and advances the raw cursor', async () => {
    const observation = {
      id: 'a',
      text: 'US CPI ACTUAL 2.5% FORECAST 2.4%',
      timestamp: 1,
      source: 'wire',
      url: '',
      handle: null,
      ruleTag: null,
      classification: 'GOOD',
      upstreamCreatedAt: null,
    };
    page.mockReturnValue({
      events: [
        {
          cursor: 'abc:1',
          sequence: 1,
          receivedAt: 2,
          firstReceivedAt: 2,
          revision: 1,
          backfill: false,
          observation,
        },
        {
          cursor: 'abc:2',
          sequence: 2,
          receivedAt: 3,
          firstReceivedAt: 3,
          revision: 1,
          backfill: false,
          observation: { ...observation, id: 'b', text: 'Bitcoin rises' },
        },
      ],
      nextCursor: 'abc:2',
      oldestCursor: 'abc:0',
      hasMore: false,
    });
    const app = Fastify();
    await app.register(newsMacroRoute);
    const response = await app.inject('/news/macro?after=abc:0');
    const data = NewsMacroResponseSchema.parse(response.json());
    expect(data.items).toHaveLength(1);
    expect(data.scanned).toBe(2);
    expect(data.nextCursor).toBe('abc:2');
    expect(data.items[0]?.actual?.value).toBe(2.5);
    expect(data.scheduledCalendarAvailable).toBe(false);
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });
  it('rejects invalid queries and reports expired replay cursors', async () => {
    const app = Fastify();
    await app.register(newsMacroRoute);
    expect((await app.inject('/news/macro?limit=0')).statusCode).toBe(400);
    page.mockImplementation(() => {
      throw new NewsCursorError('abc:1');
    });
    expect((await app.inject('/news/macro?after=abc:0')).statusCode).toBe(409);
    await app.close();
  });
});
