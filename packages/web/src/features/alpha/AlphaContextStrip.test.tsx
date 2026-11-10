import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('compact premium context', () => {
  it('shows pricing color independently of directional verdicts and keeps measurements collapsed', () => {
    const data = context();
    const view = render(
      <AlphaContextStrip context={data} strategy="call-credit" loading={false} />,
    );
    const strip = screen.getByLabelText('Alpha market context');
    expect(strip.textContent).toContain('RICH');
    expect(screen.getByText('RICH').closest('[data-tone]')?.getAttribute('data-tone')).toBe('good');
    expect(strip.textContent).toContain('3.0D to expiry');
    expect(
      screen.queryByText(/Downward price pressure|Why this verdict|CONDITIONS SUPPORT/),
    ).toBeNull();
    const details = screen.getByText('Volatility details').closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText('Volatility details'));
    expect(details.open).toBe(true);
    view.rerender(<AlphaContextStrip context={data} strategy="call-debit" loading={false} />);
    expect(screen.getByText('RICH').closest('[data-tone]')?.getAttribute('data-tone')).toBe('bad');
  });

  it('can show high absolute IV as cheap when the matched realized reference is higher', () => {
    const data = context();
    data.automatic!.pricing.atmIv = 0.8;
    data.automatic!.pricing.forecastVol = 1;
    render(<AlphaContextStrip context={data} strategy="call-debit" loading={false} />);
    expect(screen.getByText('CHEAP').closest('[data-tone]')?.getAttribute('data-tone')).toBe(
      'good',
    );
    expect(screen.getByLabelText('Alpha market context').textContent).toContain('80.0% / 100.0%');
    expect(screen.getByText('−20.0 pts')).toBeTruthy();
  });

  it('labels multi-expiry scanner context as a reference and withholds missing pricing', () => {
    const data = context();
    data.automatic!.horizonSource = 'scan-reference';
    data.automatic!.horizonDays = 30;
    const view = render(
      <AlphaContextStrip context={data} strategy="protective-put" loading={false} />,
    );
    expect(screen.getByText('30.0D reference')).toBeTruthy();
    delete data.automatic;
    view.rerender(<AlphaContextStrip context={data} strategy="long-call" loading={false} />);
    expect(screen.getByLabelText('Alpha market context').textContent).toContain('UNAVAILABLE');
    expect(screen.queryByText('FAVORABLE')).toBeNull();
  });

  it('retains excluded scanner setup rules', () => {
    render(<AlphaContextStrip context={context()} strategy="iron-fly" loading={false} />);
    expect(screen.getByLabelText('Alpha market context').textContent).toContain('FAVORABLE');
  });

  it('withholds colors for stale context', () => {
    const data = context();
    data.generatedAt -= 121_000;
    render(<AlphaContextStrip context={data} strategy="put-credit" loading={false} />);
    expect(screen.queryByText('RICH')).toBeNull();
    expect(screen.getAllByText('UNAVAILABLE').length).toBeGreaterThan(0);
  });
});
