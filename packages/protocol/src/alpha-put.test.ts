import { describe, expect, it } from 'vitest';

import { AlphaPutScannerQuerySchema } from './alpha-put.js';

describe('Alpha put scanner contract', () => {
  it('defaults to protection ranking with no holding to hedge', () => {
    const result = AlphaPutScannerQuerySchema.parse({ underlying: 'btc', venues: 'deribit,thalex' });

    expect(result.underlying).toBe('BTC');
    expect(result.venues).toEqual(['deribit', 'thalex']);
    expect(result.rankBy).toBe('protection');
    expect(result.hedgeQty).toBe(0);
  });

  it('coerces hedge quantity and ranking from HTTP query strings', () => {
    const result = AlphaPutScannerQuerySchema.parse({ hedgeQty: '1.5', rankBy: 'convexity' });

    expect(result.hedgeQty).toBe(1.5);
    expect(result.rankBy).toBe('convexity');
  });

  it('rejects inverted OTM bounds and unknown rankings', () => {
    expect(() => AlphaPutScannerQuerySchema.parse({ minOtmPct: 20, maxOtmPct: 10 })).toThrow();
    expect(() => AlphaPutScannerQuerySchema.parse({ rankBy: 'yolo' })).toThrow();
  });
});
