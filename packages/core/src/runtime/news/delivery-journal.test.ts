import { describe, expect, it, vi } from 'vitest';
import type { NewsDeliveryEvent, NewsObservation } from '@oggregator/protocol';
import {
  NewsCursorError,
  NewsDeliveryJournal,
  type NewsDeliveryStore,
} from './delivery-journal.js';

function observation(id: string, timestamp = 10): NewsObservation {
  return {
    id,
    text: id,
    url: 'https://example.com',
    source: 'test',
    handle: null,
    ruleTag: null,
    timestamp,
    classification: 'GOOD',
    upstreamCreatedAt: null,
  };
}
function storage() {
  let rows: NewsDeliveryEvent[] = [];
  const store: NewsDeliveryStore = {
    read: () => structuredClone(rows),
    append: (events) => {
      rows.push(...structuredClone(events));
    },
    replace: (events) => {
      rows = structuredClone(events);
    },
  };
  return store;
}

describe('arrival-ordered news delivery', () => {
  it('delivers late and equal-time headlines without duplicate observations', () => {
    const journal = new NewsDeliveryJournal(storage(), 100, () => 1000);
    journal.record([observation('new', 100), observation('new', 100)]);
    const cursor = journal.cursor;
    journal.record([observation('new', 100), observation('late', 1), observation('equal', 100)]);
    expect(journal.page(cursor, 200).events.map((event) => event.observation.id)).toEqual([
      'late',
      'equal',
    ]);
    expect(journal.size).toBe(3);
  });

  it('persists revisions, first receipt, and cursors across restart', () => {
    const store = storage();
    let now = 1000;
    const journal = new NewsDeliveryJournal(store, 100, () => now);
    journal.record([observation('a')]);
    const cursor = journal.cursor;
    now = 2000;
    journal.record([{ ...observation('a'), text: 'corrected', classification: 'BAD' }]);
    const restored = new NewsDeliveryJournal(store);
    expect(restored.cursor).toBe(journal.cursor);
    expect(restored.page(cursor, 1).events[0]).toMatchObject({
      revision: 2,
      firstReceivedAt: 1000,
      receivedAt: 2000,
    });
    restored.record([{ ...observation('a'), text: 'corrected', classification: 'BAD' }]);
    expect(restored.size).toBe(2);
  });

  it('pages oldest-first and rejects expired, foreign and future cursors', () => {
    const journal = new NewsDeliveryJournal(storage(), 2);
    const expired = journal.cursor;
    journal.record([observation('a'), observation('b'), observation('c')]);
    expect(() => journal.page(expired, 2)).toThrow(NewsCursorError);
    expect(() => journal.page('abc:1', 2)).toThrow(NewsCursorError);
    expect(() => journal.page(journal.cursor.replace(/:3$/, ':4'), 2)).toThrow(NewsCursorError);
    const first = journal.page(journal.oldestCursor!, 1);
    expect(first.events[0]?.observation.id).toBe('b');
    expect(first.hasMore).toBe(true);
    expect(journal.page(first.nextCursor, 1).events[0]?.observation.id).toBe('c');
  });

  it('does not publish an event until persistence succeeds', () => {
    const store = storage();
    const append = vi.spyOn(store, 'append').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const journal = new NewsDeliveryJournal(store);
    const cursor = journal.cursor;
    expect(() => journal.record([observation('a')])).toThrow('disk full');
    expect(journal.cursor).toBe(cursor);
    expect(journal.size).toBe(0);
    expect(() => journal.record([observation('a')])).toThrow('restart');
    expect(append).toHaveBeenCalledTimes(1);
    const restored = new NewsDeliveryJournal(store);
    restored.record([observation('a')], { backfill: true });
    expect(restored.page(undefined, 1).events[0]).toMatchObject({ sequence: 1, backfill: true });
  });
});
