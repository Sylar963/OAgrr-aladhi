import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('uses round axis ticks with a $0 line and labels spot and break-even', () => {
    const { container } = render(
      <PortfolioPnlCurve
        forwardDays={0}
        curve={curve({ breakEvenPricesUsd: [86_000], expiryBasis: 'common_expiry' })}
      />,
    );
    const labels = [...container.querySelectorAll('svg text')].map((node) => node.textContent);

    expect(labels).toContain('$0');
    expect(labels).toContain('82,000');
    expect(labels).toContain('spot 84,000');
    expect(labels).toContain('BE 86,000');
    expect(labels.some((label) => label === '+2%')).toBe(true);
  });

  it('shows the P&L readout for the nearest point under the pointer', () => {
    const { container } = render(<PortfolioPnlCurve forwardDays={0} curve={curve({})} />);
    const svg = container.querySelector('svg');
    if (svg == null) throw new Error('chart missing');
    const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ ...identity, inverse: () => identity }) });

    fireEvent.pointerMove(svg, { clientX: 690, clientY: 100 });
    const readout = screen.getByTestId('pnl-hover');

    expect(readout.textContent).toContain('90,000');
    expect(readout.textContent).toContain('+7.1%');
    expect(readout.textContent).toContain('+$20');
    expect(readout.textContent).toContain('+$10');

    fireEvent.pointerLeave(svg);
    expect(screen.queryByTestId('pnl-hover')).toBeNull();
  });
});
