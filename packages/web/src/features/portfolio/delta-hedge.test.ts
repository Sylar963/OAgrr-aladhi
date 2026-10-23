import { describe, expect, it } from 'vitest';

import { deltaHedgeState } from './delta-hedge';

describe('deltaHedgeState', () => {
  it('is hedged when options plus perp delta rounds to zero', () => {
    expect(deltaHedgeState(-0.022 + 0.022)).toBe('hedged');
    expect(deltaHedgeState(0.0004)).toBe('hedged');
    expect(deltaHedgeState(-0.0004)).toBe('hedged');
  });

  it('reports the unhedged side', () => {
    expect(deltaHedgeState(0.002)).toBe('long');
    expect(deltaHedgeState(-0.022)).toBe('short');
  });
});
