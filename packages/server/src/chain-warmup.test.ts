import { describe, expect, it } from 'vitest';
import { warmupVenues } from './chain-warmup.js';

describe('warmupVenues', () => {
  it('skips Coincall from generic chain warmup', () => {
    expect(warmupVenues(['deribit', 'coincall', 'okx'])).toEqual(['deribit', 'okx']);
  });

  it('preserves other venues unchanged', () => {
    expect(warmupVenues(['deribit', 'okx', 'bybit'])).toEqual(['deribit', 'okx', 'bybit']);
  });
});
