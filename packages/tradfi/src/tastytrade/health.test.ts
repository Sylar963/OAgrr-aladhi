import { describe, expect, it } from 'vitest';
import { isUsEquityMarketOpen } from './health.js';

describe('isUsEquityMarketOpen', () => {
  it('open on a weekday mid-session', () => {
    // 2026-04-16 is a Thursday; 14:00 UTC = 10:00 ET (EDT)
    expect(isUsEquityMarketOpen(Date.parse('2026-04-16T14:00:00Z'))).toBe(true);
  });
  it('closed on weekend', () => {
    // 2026-04-18 is a Saturday
    expect(isUsEquityMarketOpen(Date.parse('2026-04-18T14:00:00Z'))).toBe(false);
  });
  it('closed before the open', () => {
    // 12:00 UTC = 08:00 ET, before 09:30
    expect(isUsEquityMarketOpen(Date.parse('2026-04-16T12:00:00Z'))).toBe(false);
  });
});
