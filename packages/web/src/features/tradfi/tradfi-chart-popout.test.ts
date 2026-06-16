import { describe, expect, it } from 'vitest';
import { buildTradfiPopoutSearch, parseTradfiPopoutParams } from './tradfi-chart-popout';

describe('tradfi popout params round-trip', () => {
  it('builds and re-parses', () => {
    const search = buildTradfiPopoutSearch({
      underlying: 'SPY',
      expiry: '2026-06-19',
      strike: 500,
      type: 'call',
    });
    const parsed = parseTradfiPopoutParams(`?${search}`);
    expect(parsed).toMatchObject({
      underlying: 'SPY',
      expiry: '2026-06-19',
      strike: 500,
      type: 'call',
      mode: 'price',
    });
  });

  it('returns null when provider is not tradfi', () => {
    expect(parseTradfiPopoutParams('?popout=1&provider=crypto&underlying=SPY')).toBeNull();
  });

  it('returns null on missing fields', () => {
    expect(parseTradfiPopoutParams('?popout=1&provider=tradfi&underlying=SPY')).toBeNull();
  });

  it('returns null on an invalid type', () => {
    expect(
      parseTradfiPopoutParams(
        '?popout=1&provider=tradfi&underlying=SPY&expiry=2026-06-19&strike=500&type=straddle',
      ),
    ).toBeNull();
  });

  it('returns null on a non-positive strike', () => {
    for (const strike of ['0', '-100']) {
      expect(
        parseTradfiPopoutParams(
          `?popout=1&provider=tradfi&underlying=SPY&expiry=2026-06-19&strike=${strike}&type=call`,
        ),
      ).toBeNull();
    }
  });
});
