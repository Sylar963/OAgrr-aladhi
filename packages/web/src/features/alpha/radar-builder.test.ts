import { describe, expect, it } from 'vitest';

import { candidateToBuilderLeg } from './radar-builder';

describe('candidateToBuilderLeg', () => {
  it('normalizes native contract economics into Builder base units', () => {
    const leg = candidateToBuilderLeg({
      venue: 'okx',
      underlying: 'BTC',
      instrument: 'BTC-USD-260918-100000-C',
      expiry: '2026-09-18',
      strike: 100_000,
      contractSize: 0.01,
      minQty: 2,
      ask: 25,
      delta: 0.18,
      markIv: 0.52,
    });

    expect(leg).toMatchObject({
      id: 'radar:okx:BTC-USD-260918-100000-C',
      type: 'call',
      direction: 'buy',
      quantity: 0.02,
      entryPrice: 2_500,
      venue: 'okx',
      delta: 0.18,
      iv: 0.52,
    });
  });
});
