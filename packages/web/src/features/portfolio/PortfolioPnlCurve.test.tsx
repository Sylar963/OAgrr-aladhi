import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExpiryRiskWindow, PortfolioPnlCurve as PortfolioPnlCurveData } from '@oggregator/protocol';

import PortfolioPnlCurve from './PortfolioPnlCurve';

function riskWindow(partial: Partial<ExpiryRiskWindow> & Pick<ExpiryRiskWindow, 'from' | 'until'>): ExpiryRiskWindow {
  return {
    liveLegIds: [],
    netCallSize: 0,
    upsideUnbounded: false,
    lossAtZeroSpotUsd: -100,
    worstLossUsd: -100,
    worstLossSpotUsd: 0,
    ...partial,
  };
}

function curve(partial: Partial<PortfolioPnlCurveData>): PortfolioPnlCurveData {
  return {
    status: 'ok',
    underlying: 'BTC',
    currentSpotUsd: 84_000,
    breakEvenPricesUsd: [],
    maxProfitUsd: null,
    maxLossUsd: null,
    upsideBounded: false,
    downsideBounded: true,
    points: [
      { underlyingPriceUsd: 80_000, nowPnlUsd: -10, forwardPnlUsd: null, expiryPnlUsd: -18 },
      { underlyingPriceUsd: 90_000, nowPnlUsd: 20, forwardPnlUsd: null, expiryPnlUsd: 10 },
    ],
    expiryBasis: 'mixed_expiry',
    riskWindows: [],
    ...partial,
  };
}

afterEach(cleanup);

describe('PortfolioPnlCurve', () => {
  it('names the expiry after which upside loss is unbounded', () => {
    render(
      <PortfolioPnlCurve
        forwardDays={0}
        mixedExpiries
        curve={curve({
          riskWindows: [
            riskWindow({ from: '2026-10-07T12:00:00.000Z', until: '2026-10-16' }),
            riskWindow({
              from: '2026-10-16',
              until: '2026-10-30',
              netCallSize: -1,
              upsideUnbounded: true,
              worstLossUsd: null,
              worstLossSpotUsd: null,
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText('Upside unbounded after 16 OCT')).toBeTruthy();
    expect(screen.queryByText(/same-price scenario low/)).toBeNull();
  });

  it('labels a bounded mixed-expiry loss as the expiry-window low', () => {
    render(
      <PortfolioPnlCurve
        forwardDays={0}
        mixedExpiries
        curve={curve({
          maxLossUsd: -1_000,
          riskWindows: [
            riskWindow({ from: '2026-10-07T12:00:00.000Z', until: '2026-10-16', worstLossUsd: -1_000 }),
            riskWindow({ from: '2026-10-16', until: '2026-10-30', netCallSize: 1 }),
          ],
        })}
      />,
    );

    expect(screen.getByText('expiry-window low -$1,000')).toBeTruthy();
    expect(screen.queryByText(/Upside unbounded/)).toBeNull();
  });
});
