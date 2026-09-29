import { describe, expect, it } from 'vitest';

import { candidateToBuilderLeg, putCandidateToBuilderLeg } from './radar-builder';

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

describe('putCandidateToBuilderLeg', () => {
  const base = {
    venue: 'deribit' as const,
    underlying: 'BTC',
    instrument: 'BTC-30OCT26-90000-P',
    expiry: '2026-10-30',
    strike: 90_000,
    contractSize: 1,
    minQty: 0.1,
    ask: 1_500,
    delta: -0.2,
    markIv: 0.5,
  };

  it('buys the hedge-covered quantity of puts', () => {
    expect(putCandidateToBuilderLeg({ ...base, hedge: { coveredQty: 1.5 } })).toMatchObject({
      type: 'put',
      direction: 'buy',
      quantity: 1.5,
      entryPrice: 1_500,
    });
  });

  it('falls back to the venue minimum without a hedge', () => {
    expect(putCandidateToBuilderLeg({ ...base, hedge: null }).quantity).toBe(0.1);
  });
});
