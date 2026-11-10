import { describe, expect, it } from 'vitest';
import { AlphaMarketContextQuerySchema } from './alpha-market-context.js';

describe('automatic context query', () => {
  it('accepts automatic selected-chain observations and retains the underlying-only contract', () => {
    expect(AlphaMarketContextQuerySchema.parse({ underlying: ' btc ' })).toEqual({
      underlying: 'BTC',
    });
    expect(
      AlphaMarketContextQuerySchema.parse({
        underlying: 'BTC',
        expiryTs: '1800000000000',
        selectedIv: '0.4',
        ivAsOfMs: '1799999990000',
        selectedSkew: '-0.02',
        selectedBfly: '0.01',
      }).selectedIv,
    ).toBe(0.4);
  });
  it('rejects invalid numeric horizons and observations', () => {
    for (const query of [
      { horizonDays: 0 },
      { horizonDays: 91 },
      { selectedIv: -1 },
      { selectedIv: 'NaN' },
      { selectedIv: 11 },
      { ivAsOfMs: -1 },
      { selectedSkew: 'Infinity' },
    ]) {
      expect(AlphaMarketContextQuerySchema.safeParse({ underlying: 'BTC', ...query }).success).toBe(
        false,
      );
    }
  });
});
