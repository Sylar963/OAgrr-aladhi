import { describe, expect, it, vi } from 'vitest';
import { ResponseCache } from './response-cache.js';

describe('ResponseCache', () => {
  it('dedupes concurrent loads for the same key', async () => {
    const cache = new ResponseCache<number>(1_000);
    const load = vi.fn(async () => 42);

    const [left, right] = await Promise.all([
      cache.get('same', load),
      cache.get('same', load),
    ]);

    expect(left).toBe(42);
    expect(right).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refreshes after the ttl expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    try {
      const cache = new ResponseCache<number>(100);
      let nextValue = 1;
      const load = vi.fn(async () => nextValue++);

      await expect(cache.get('key', load)).resolves.toBe(1);
      vi.setSystemTime(101);
      await expect(cache.get('key', load)).resolves.toBe(2);

      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
