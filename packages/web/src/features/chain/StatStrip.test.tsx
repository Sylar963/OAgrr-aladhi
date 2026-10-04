import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import type { TenorRichness, VolRichness } from '@oggregator/protocol';
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

  it('shows IV vs forecast for the selected expiry and no 52-week IVP tile', () => {
    const tenor = (tenorDays: 7 | 30): TenorRichness => ({
      tenorDays,
      atmIv: 0.3,
      forecastVol: 0.35,
      ivMinusForecast: -0.05,
      premiumBaseline: {
        tenorDays,
        source: 'blended',
        medianSpread: 0.09,
        sampleCount: 150,
        independentSampleCount: 20,
      },
      excessPremium: -0.14,
      excessChange24h: 0.01,
      excessHistory: { zScore: -1.4, percentile: 8, sampleCount: 170, firstTs: 0 },
      conePercentile: 30,
      intraday: { ivChange24h: -0.01, zScore24h: -0.8, zScore7d: -1.1, samples24h: 288, samples7d: 2016 },
      level: { percentile90d: 11, percentile1y: tenorDays === 30 ? 3 : null },
      state: 'cheap',
    });
    const richness: VolRichness = {
      generatedAt: 0,
      underlying: 'BTC',
      forecast: {
        method: 'mean-reverting-realized-v1',
        rv7d: 0.34,
        rv30d: 0.35,
        longRunVol: 0.36,
        longRunDays: 180,
        halfLifeDays: 14,
      },
      tenors: { '7d': tenor(7), '30d': tenor(30) },
      termStructure: { state: 'contango', slope: 0.07 },
      forecastCurve: [{ dteDays: 7, forecastVol: 0.35, usualPremium: 0.09 }],
      volCone: [],
      fairBand: 0.02,
    };
    const marketStats = {
      underlying: 'BTC',
      spot: null,
      dvol: { current: 0.35, ivp: 3.3, ivChange1d: -0.01, high52w: 0.9, low52w: 0.33 },
    };

    const { container } = render(
      <StatStrip
        stats={STATS}
        underlying="BTC"
        dte={7}
        marketStats={marketStats}
        richness={richness}
      />,
    );
    const screen = within(container);

    expect(screen.getByText('IV vs Fcst')).toBeTruthy();
    expect(screen.getByText('+6.0 pts')).toBeTruthy();
    expect(screen.getByText('RICH · 7D −0.8σ 24h')).toBeTruthy();
    expect(screen.queryByText('1y IV lvl')).toBeNull();
    expect(screen.queryByText('IVP')).toBeNull();
    expect(screen.getByText('IV Δ1d')).toBeTruthy();
  });
});
