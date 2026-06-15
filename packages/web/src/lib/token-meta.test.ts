import { describe, expect, it } from 'vitest';

import { getUnderlyingDisplayMeta } from './token-meta';

describe('getUnderlyingDisplayMeta', () => {
  it('collapses alias-only underlyings to the base label', () => {
    expect(getUnderlyingDisplayMeta('AVAX_USDC', ['AVAX_USDC'])).toEqual({
      label: 'AVAX',
      sublabel: 'USDC-settled options',
      searchText: 'AVAX_USDC AVAX AVAX/USDC USDC',
    });
  });

  it('keeps sibling variants distinguishable when the base also exists', () => {
    expect(getUnderlyingDisplayMeta('BTC_USDC', ['BTC', 'BTC_USDC']).label).toBe('BTC/USDC');
  });
});
