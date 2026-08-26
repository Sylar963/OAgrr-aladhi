import { describe, expect, it } from 'vitest';

import { AlphaMarketContextQuerySchema } from './alpha-market-context.js';
import { AlphaLottoScannerQuerySchema } from './alpha-lotto.js';

describe('Alpha scanner contracts', () => {
  it('parses an underlying and comma-separated venue query', () => {
    const result = AlphaLottoScannerQuerySchema.parse({
      underlying: 'eth',
      venues: 'deribit,okx,thalex',
    });

    expect(result.underlying).toBe('ETH');
    expect(result.venues).toEqual(['deribit', 'okx', 'thalex']);
  });

  it('rejects unknown scanner venues', () => {
    expect(() => AlphaLottoScannerQuerySchema.parse({ venues: 'deribit,unknown' })).toThrow();
  });

  it('normalizes the market-context underlying', () => {
    expect(AlphaMarketContextQuerySchema.parse({ underlying: 'btc' }).underlying).toBe('BTC');
  });
});
