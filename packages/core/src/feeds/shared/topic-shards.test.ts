import { afterEach, describe, expect, it, vi } from 'vitest';
import { PacedSender, TopicShardAllocator, aggregateShardState } from './topic-shards.js';

const topics = (n: number, prefix = 't') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('TopicShardAllocator', () => {
  it('fills shards up to capacity and opens a new shard only when full', () => {
    const allocator = new TopicShardAllocator(200);

    const first = allocator.assign(topics(450));

    expect(allocator.shardCount).toBe(3);
    expect(first.get(0)).toHaveLength(200);
    expect(first.get(1)).toHaveLength(200);
    expect(first.get(2)).toHaveLength(50);
    expect(allocator.size).toBe(450);
  });

  it('ignores topics it already owns', () => {
    const allocator = new TopicShardAllocator(2);
    allocator.assign(['a', 'b']);

    const again = allocator.assign(['a', 'b', 'c']);

    expect([...again.entries()]).toEqual([[1, ['c']]]);
  });

  it('reuses freed capacity in earlier shards before growing', () => {
    const allocator = new TopicShardAllocator(2);
    allocator.assign(['a', 'b', 'c']);

    expect([...allocator.release(['a', 'zzz']).entries()]).toEqual([[0, ['a']]]);
    expect([...allocator.assign(['d']).entries()]).toEqual([[0, ['d']]]);
    expect(allocator.shardCount).toBe(2);
    expect(allocator.topicsFor(0).sort()).toEqual(['b', 'd']);
    expect(allocator.shardOf('c')).toBe(1);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new TopicShardAllocator(0)).toThrow();
  });
});

describe('aggregateShardState', () => {
  it('reports down when any shard is down and connected only when all are', () => {
    expect(aggregateShardState([])).toBe('down');
    expect(aggregateShardState(['connected', 'connected'])).toBe('connected');
    expect(aggregateShardState(['connected', 'reconnecting'])).toBe('reconnecting');
    expect(aggregateShardState(['connected', 'down'])).toBe('down');
  });
});

describe('PacedSender', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends at most perTick messages per tick', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const sender = new PacedSender<number>((n) => sent.push(n), 5, 100);

    sender.enqueue(Array.from({ length: 12 }, (_, i) => i));
    expect(sent).toHaveLength(5);

    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(10);

    vi.advanceTimersByTime(100);
    expect(sent).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(sender.pending).toBe(0);
  });

  it('drops superseded and cleared messages', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const sender = new PacedSender<number>((n) => sent.push(n), 1, 100);

    sender.enqueue([1, 2, 3, 4]);
    sender.remove((n) => n === 3);
    vi.advanceTimersByTime(100);
    sender.clear();
    vi.advanceTimersByTime(1_000);

    expect(sent).toEqual([1, 2]);
  });
});
