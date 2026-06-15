import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StatStrip from './StatStrip';
import type { ChainStats } from '@shared/enriched';

const STATS: ChainStats = {
  indexPriceUsd: 100, forwardPriceUsd: 101, atmIv: 0.5, atmStrike: 100,
  putCallOiRatio: 1.1, skew25d: 0.02, totalOiUsd: 1000, basisPct: 0.1,
} as ChainStats;

describe('StatStrip', () => {
  it('renders when dvol fields are undefined without crashing', () => {
    // dvol object present but ivr / ivChange1d missing — the real crash shape
    const marketStats = { underlying: 'BTC', spot: null, dvol: {} } as never;
    expect(() =>
      render(<StatStrip stats={STATS} underlying="BTC" dte={7} marketStats={marketStats} />),
    ).not.toThrow();
  });

  it('renders with no marketStats (TradFi case)', () => {
    expect(() =>
      render(<StatStrip stats={STATS} underlying="AAPL" dte={7} marketStats={null} />),
    ).not.toThrow();
  });
});
