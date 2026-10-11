import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BreakEvenIvRow, PositionLeg, VegaByStrikeRow } from '@oggregator/protocol';

import PortfolioVegaCurve from './PortfolioVegaCurve';

const EXPIRY = '2026-10-30';

const positions: PositionLeg[] = [
  {
    legId: 'call-78k',
    underlying: 'BTC',
    expiry: EXPIRY,
    strike: 78_000,
    optionRight: 'call',
    size: 0.02,
    entryPriceUsd: 5_000,
    entryIv: 0.4,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: null,
    source: 'manual',
  },
];

const byStrike: VegaByStrikeRow[] = [
  {
    strike: 78_000,
    expiry: EXPIRY,
    optionRight: 'call',
    delta: 0.015,
    vega: 1.1,
    gamma: 0.0000002,
    theta: -1.2,
    vanna: 0.0001,
    volga: 0.01,
    contracts: 0.02,
  },
];

const breakEven: BreakEvenIvRow[] = [
  {
    legId: 'call-78k',
    strike: 78_000,
    expiry: EXPIRY,
    optionRight: 'call',
    entryIv: 0.4,
    currentMarkUsd: 6_000,
    currentIv: 0.42,
    breakEvenIv: 0.38,
    ivCushionPct: 0.1,
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-11T08:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PortfolioVegaCurve', () => {
  it('opens on the spot profile with one line per horizon and keeps the strike bars', () => {
    render(
      <PortfolioVegaCurve
        positions={positions}
        byStrike={byStrike}
        breakEven={breakEven}
        spotUsd={82_957}
        underlying="BTC"
      />,
    );

    expect(screen.getByText('Risk profile across spot')).toBeTruthy();
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByText('+10d')).toBeTruthy();
    expect(screen.getByText('+18d · 1d left')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'By strike' }));
    expect(screen.getByText('Risk concentration by strike')).toBeTruthy();
  });

  it('draws vol convexity against IV shocks instead of spot', () => {
    render(
      <PortfolioVegaCurve
        positions={positions}
        byStrike={byStrike}
        breakEven={breakEven}
        spotUsd={82_957}
        underlying="BTC"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Vol convexity/ }));
    expect(screen.getByText('P&L across IV shocks')).toBeTruthy();
    expect(screen.getByText('Full reprice')).toBeTruthy();
    expect(screen.getByText('Vega only')).toBeTruthy();
  });

  it('falls back to strike bars when live spot is missing', () => {
    render(
      <PortfolioVegaCurve
        positions={positions}
        byStrike={byStrike}
        breakEven={breakEven}
        spotUsd={null}
        underlying="BTC"
      />,
    );

    expect(screen.getByText('Risk concentration by strike')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Curve' }).hasAttribute('disabled')).toBe(true);
  });
});
