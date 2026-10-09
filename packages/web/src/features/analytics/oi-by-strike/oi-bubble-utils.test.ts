import { describe, it, expect } from 'vitest';
import type { BlockStrikeBucket } from '@shared/common';

import { selectBlockBubbles } from './oi-bubble-utils';

function bucket(overrides: Partial<BlockStrikeBucket> = {}): BlockStrikeBucket {
  return {
    ts: 3600,
    strike: 80_000,
    expiry: '2026-10-30',
    callContracts: 2,
    putContracts: 1,
    callNotionalUsd: 160_000,
    putNotionalUsd: 80_000,
    legs: 3,
    ...overrides,
  };
}

const none = new Set<string>();

describe('selectBlockBubbles', () => {
  it('merges expiries into one bubble per candle and strike', () => {
    const bubbles = selectBlockBubbles(
      [bucket(), bucket({ expiry: '2026-11-27', callContracts: 0, putContracts: 4, legs: 1 })],
      { mode: 'contracts', side: 'both', hiddenExpiries: none },
    );
    expect(bubbles).toEqual([
      { timeSec: 3600, strike: 80_000, callValue: 2, putValue: 5, value: 7, dominant: 'put', legs: 4 },
    ]);
  });

  it('switches between contracts and notional', () => {
    const [b] = selectBlockBubbles([bucket()], { mode: 'notional', side: 'both', hiddenExpiries: none });
    expect(b).toMatchObject({ callValue: 160_000, putValue: 80_000, value: 240_000, dominant: 'call' });
  });

  it('honours the Calls / Puts side filter', () => {
    const [calls] = selectBlockBubbles([bucket()], { mode: 'contracts', side: 'calls', hiddenExpiries: none });
    expect(calls).toMatchObject({ callValue: 2, putValue: 0, dominant: 'call' });
    const puts = selectBlockBubbles([bucket({ putContracts: 0 })], { mode: 'contracts', side: 'puts', hiddenExpiries: none });
    expect(puts).toEqual([]);
  });

  it('drops expiries hidden in the legend but keeps unknown expiries', () => {
    const bubbles = selectBlockBubbles(
      [bucket(), bucket({ strike: 90_000, expiry: null })],
      { mode: 'contracts', side: 'both', hiddenExpiries: new Set(['2026-10-30']) },
    );
    expect(bubbles.map((b) => b.strike)).toEqual([90_000]);
  });

  it('orders bubbles small to large so big prints paint on top', () => {
    const bubbles = selectBlockBubbles(
      [bucket({ strike: 1, callContracts: 9 }), bucket({ strike: 2, callContracts: 0 })],
      { mode: 'contracts', side: 'both', hiddenExpiries: none },
    );
    expect(bubbles.map((b) => b.strike)).toEqual([2, 1]);
  });
});
