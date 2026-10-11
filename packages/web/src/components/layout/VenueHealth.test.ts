import { describe, expect, it } from 'vitest';

import { formatLatency } from './FreshnessLabel';
import { healthLevel, STALE_BAD_MS, STALE_WARN_MS } from './VenueHealth';

describe('healthLevel', () => {
  const live = { connectionState: 'live' as const, staleMs: 120, liveCount: 9, activeCount: 9 };

  it('is ok when every active venue is live and data is fresh', () => {
    expect(healthLevel(live)).toBe('ok');
  });

  it('warns when a venue drops or data starts to lag', () => {
    expect(healthLevel({ ...live, liveCount: 8 })).toBe('warn');
    expect(healthLevel({ ...live, staleMs: STALE_WARN_MS })).toBe('warn');
    expect(healthLevel({ ...live, connectionState: 'reconnecting' })).toBe('warn');
  });

  it('is bad on error, no live venues, or badly stale data', () => {
    expect(healthLevel({ ...live, connectionState: 'error' })).toBe('bad');
    expect(healthLevel({ ...live, liveCount: 0 })).toBe('bad');
    expect(healthLevel({ ...live, staleMs: STALE_BAD_MS })).toBe('bad');
  });
});

describe('formatLatency', () => {
  it('keeps ms under a second and switches to seconds/minutes above', () => {
    expect(formatLatency(240)).toBe('240ms');
    expect(formatLatency(2_340)).toBe('2.3s');
    expect(formatLatency(64_826)).toBe('1m');
    expect(formatLatency(42_000)).toBe('42s');
  });
});
