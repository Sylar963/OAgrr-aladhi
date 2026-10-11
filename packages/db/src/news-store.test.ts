import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { type PersistedNewsItem, PostgresNewsStore } from './news-store.js';

function item(index: number): PersistedNewsItem {
  return {
    id: `n${index}`,
    publishedAt: new Date(index * 1000),
    ingestedAt: new Date(index * 1000 + 500),
    text: `headline ${index}`,
    url: `https://twitter.com/x/status/${index}`,
    source: 'Twitter[brain-fastlane] - @FirstSquawk',
    handle: 'FirstSquawk',
    ruleTag: null,
  };
}

describe('PostgresNewsStore', () => {
  it('inserts in batches with ON CONFLICT DO NOTHING', async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({ rows: [] }));
    const store = new PostgresNewsStore({ query } as unknown as Pool);

    await store.writeMany(Array.from({ length: 501 }, (_, index) => item(index)));

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT (id) DO NOTHING');
    expect(query.mock.calls[0]?.[1].slice(0, 8)).toEqual([
      'n0',
      new Date(0),
      new Date(500),
      'headline 0',
      'https://twitter.com/x/status/0',
      'Twitter[brain-fastlane] - @FirstSquawk',
      'FirstSquawk',
      null,
    ]);
    expect(query.mock.calls[1]?.[1]).toHaveLength(8);
  });

  it('pages with a keyset cursor and maps rows', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'a',
          published_at: new Date(2000),
          ingested_at: new Date(2100),
          text: 't',
          url: 'u',
          source: 's',
          handle: null,
          rule_tag: 'brain-fastlane',
        },
      ],
    });
    const store = new PostgresNewsStore({ query } as unknown as Pool);

    const rows = await store.loadPage({
      since: new Date(0),
      before: { publishedAt: new Date(3000), id: 'b' },
      limit: 10,
    });

    expect(query.mock.calls[0]?.[0]).toContain('(published_at, id) < ($2, $3)');
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $4');
    expect(query.mock.calls[0]?.[1]).toEqual([new Date(0), new Date(3000), 'b', 10]);
    expect(rows).toEqual([
      {
        id: 'a',
        publishedAt: new Date(2000),
        ingestedAt: new Date(2100),
        text: 't',
        url: 'u',
        source: 's',
        handle: null,
        ruleTag: 'brain-fastlane',
      },
    ]);
  });

  it('omits the cursor clause on the first page', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await new PostgresNewsStore({ query } as unknown as Pool).loadPage({
      since: new Date(0),
      before: null,
      limit: 5,
    });
    expect(query.mock.calls[0]?.[0]).not.toContain('(published_at, id) <');
    expect(query.mock.calls[0]?.[1]).toEqual([new Date(0), 5]);
  });
});
