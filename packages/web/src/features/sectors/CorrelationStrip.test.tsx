import type { CryptoSectorCorrelationResponse } from '@oggregator/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const T = Date.UTC(2026, 9, 23, 1, 0);
const point = (i: number, avgCorr: number | null) => ({
  t: T - (2 - i) * 300_000,
  avgCorr,
  residualCorr: avgCorr == null ? null : avgCorr - 0.2,
  pc1Share: 0.9,
  dispersion: 0.0021,
});

const data: CryptoSectorCorrelationResponse = {
  asOf: T,
  barSec: 300,
  windowBars: 24,
  thresholds: { correlated: 0.8, dispersed: 0.5 },
  regime: 'correlated',
  regimeSince: Date.UTC(2026, 9, 22, 15, 10),
  current: point(2, 0.87),
  change1h: 0.21,
  baseline: { mean: 0.7, std: 0.1, windows: 975 },
  zScore: 1.7,
  sectorIds: ['majors'],
  views: [],
  sectors: [],
  timeline: [point(0, 0.6), point(1, null), point(2, 0.87)],
};

vi.mock('./queries', () => ({
  useSectorCorrelation: () => ({ data, isLoading: false }),
}));

import CorrelationStrip, { gapPath, readingParts, seriesPath } from './CorrelationStrip';

afterEach(cleanup);

describe('CorrelationStrip', () => {
  it('shows the regime, when it began, and the current readings', () => {
    const { container } = render(<CorrelationStrip />);
    expect(container.querySelector('[data-regime="correlated"]')!.textContent).toContain('Correlated');
    expect(screen.getByText('since 15:10 UTC')).not.toBeNull();
    expect(screen.getByText('0.87')).not.toBeNull();
    expect(screen.getByText('▲+0.21/1h')).not.toBeNull();
    expect(screen.getByText('+1.70σ vs 3.4d')).not.toBeNull();
    expect(screen.getByText('0.67')).not.toBeNull();
    expect(screen.getByText('90%')).not.toBeNull();
    expect(screen.getByText('0.21%')).not.toBeNull();
  });

  it('breaks the sparkline at missing windows', () => {
    const d = seriesPath(data.timeline, (p) => p.avgCorr, (v) => v * 10);
    expect(d).toBe('M0.0 6.0M288.0 8.7');
  });

  it('says in words what the chart shows', () => {
    render(<CorrelationStrip />);
    expect(
      screen.getByText('Sectors are moving as one block. Correlation is rising fast (+0.21 in 1h).'),
    ).not.toBeNull();

    const btcDriven = { ...data, change1h: 0.02, current: { ...data.current!, residualCorr: 0.5 } };
    expect(readingParts(btcDriven).map((p) => p.key)).toEqual(['readCorrelated', 'readBtcDriven']);

    const altFactor = {
      ...data,
      regime: 'mixed' as const,
      change1h: -0.3,
      current: { ...data.current!, avgCorr: 0.69, residualCorr: 0.66 },
      sectors: [
        { id: 'l2', name: 'L2', corrBtc: 0.2, betaBtc: 0.3, intraCorr: 0.5, meanCorr: 0.3, gapZ: -3, decoupled: true },
      ],
    };
    expect(readingParts(altFactor)).toEqual([
      { key: 'readMixed' },
      { key: 'readFalling', vars: { d: '−0.30' } },
      { key: 'readAltFactor', vars: { ex: '0.66' } },
      { key: 'readDecouplingOne', vars: { names: 'L2' } },
    ]);
  });

  it('shades the gap between the lines per run and shows a tooltip on hover', () => {
    const tl = [point(0, 0.6), point(1, 0.7), point(2, null)];
    expect(gapPath(tl, (v) => v * 10)).toBe('M0.0 6.0L144.0 7.0L144.0 5.0L0.0 4.0Z');

    const { container } = render(<CorrelationStrip />);
    const plot = container.querySelector('svg')!.parentElement!;
    plot.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.pointerMove(plot, { clientX: 100 });
    expect(screen.getByText('01:00 UTC')).not.toBeNull();
    expect(screen.getAllByText('0.87').length).toBeGreaterThan(1);
    fireEvent.pointerLeave(plot);
    expect(screen.queryByText('01:00 UTC')).toBeNull();
  });
});
