import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AlphaMarketContextResponse, AlphaStrategyContext } from '@oggregator/protocol';
import AlphaContextStrip from './AlphaContextStrip';

function context(): AlphaMarketContextResponse {
  const bearish: AlphaStrategyContext['assessments']['call-credit'] = {
    verdict: 'supported',
    reasons: ['price-down', 'vol-above-range', 'vertical-price-check'],
  };
  const bullish: typeof bearish = {
    verdict: 'poor-fit',
    reasons: ['direction-conflict', 'vol-above-range', 'downside-short-risk'],
  };
  return {
    generatedAt: Date.now(),
    underlying: 'BTC',
    spotPrice: 75_000,
    automatic: {
      version: 'market-context-v2',
      horizonDays: 3,
      horizonSource: 'selected-expiry',
      direction: 'down',
      directionBasis: 'hourly',
      moves: [{ hours: 24, returnPct: -5, sigmaUnits: -2 }],
      pricing: {
        atmIv: 0.4,
        call25Iv: 0.39,
        put25Iv: 0.43,
        source: 'selected-chain',
        forecastVol: 0.3,
        deliveryLow: 0.2,
        deliveryHigh: 0.35,
        deliveryWindowDays: 3,
        calibrationWindows: 100,
      },
      stress: {
        rv7d: 0.3,
        rv30d: 0.3,
        accelerationRatio: 1,
        accelerationPercentile: 50,
        accelerating: false,
        backwardation: false,
      },
      assessments: {
        'call-credit': bearish,
        'put-credit': bullish,
        'call-debit': bullish,
        'put-debit': bearish,
        'long-call': bullish,
        'long-put': {
          verdict: 'conditional',
          reasons: ['price-down', 'vol-above-range', 'wing-pricing'],
        },
        'protective-put': {
          verdict: 'conditional',
          reasons: ['insurance-purpose', 'vol-above-range', 'insurance-expensive'],
        },
      },
    },
    volatility: {
      state: 'compressed',
      stateSource: 'iv-percentile',
      atmIv7d: 0.4,
      atmIv30d: 0.4,
      ivPercentile7d: 1,
      ivPercentile30d: 1,
      ivChange1d: null,
      ivChange7d: null,
    },
    realized: { rv7d: 0.3, rv30d: 0.3, vrp7d: 0.1, vrp30d: 0.1 },
    expectedMoves: [],
    range: { state: 'normal', width14dPct: 10, width30dPct: 20, percentile14d: 50 },
    spotState: { state: 'inside-range', direction: 'down', extensionPct: 0 },
    setup: { longCall: 'favorable', protectivePut: 'favorable', creditSpread: 'favorable' },
    regime: null,
    richness: null,
    sources: { ivHistory: true, spotHistory: true, regime: false, ivScope: 'cross-venue' },
  };
}

afterEach(cleanup);

describe('automatic market verdict', () => {
  it('shows an automatic verdict and explanations, independent of the legacy generic setup', () => {
    const data = context();
    const view = render(
      <AlphaContextStrip context={data} strategy="call-credit" loading={false} />,
    );
    const strip = screen.getByLabelText('Alpha market context');
    expect(strip.textContent).toContain('CONDITIONS SUPPORT');
    expect(
      screen.getByText('Downward price pressure supports this bearish structure.'),
    ).toBeTruthy();
    expect(screen.getByText('Selected expiry · 3.0D remaining')).toBeTruthy();
    expect(screen.queryByText('EVALUATE SELECTED TRADE')).toBeNull();
    expect(screen.queryByRole('button', { name: /Evaluate/ })).toBeNull();
    view.rerender(<AlphaContextStrip context={data} strategy="put-credit" loading={false} />);
    expect(strip.textContent).toContain('POOR FIT');
    expect(
      screen.getByText('Observed price pressure opposes this strategy’s direction.'),
    ).toBeTruthy();
  });

  it('explains insurance separately and labels scanner horizons explicitly', () => {
    const data = context();
    data.automatic!.horizonSource = 'scan-reference';
    data.automatic!.horizonDays = 30;
    render(<AlphaContextStrip context={data} strategy="protective-put" loading={false} />);
    expect(screen.getAllByText('Protective put · insurance').length).toBeGreaterThan(0);
    expect(screen.getByText(/This put protects owned spot/)).toBeTruthy();
    expect(
      screen.getByText('30.0D scanning reference · individual candidate expiries can differ'),
    ).toBeTruthy();
  });

  it('withholds the verdict when automatic evidence is absent instead of reviving the old naive setup', () => {
    const data = context();
    delete data.automatic;
    render(<AlphaContextStrip context={data} strategy="long-call" loading={false} />);
    expect(screen.getByLabelText('Alpha market context').textContent).toContain(
      'INSUFFICIENT DATA',
    );
    expect(screen.getByText(/No scenario inputs are required/)).toBeTruthy();
  });

  it('preserves excluded scanners without applying the new strategy rules', () => {
    render(<AlphaContextStrip context={context()} strategy="iron-fly" loading={false} />);
    expect(screen.getByLabelText('Alpha market context').textContent).toContain('FAVORABLE');
    expect(screen.queryByText(/Why this verdict/)).toBeNull();
  });
});
