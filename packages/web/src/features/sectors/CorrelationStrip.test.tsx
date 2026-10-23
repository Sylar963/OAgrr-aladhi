import type { CryptoSectorCorrelationResponse } from '@oggregator/protocol';
import { cleanup, render, screen } from '@testing-library/react';
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
  matrix: [[1]],
  sectors: [],
  timeline: [point(0, 0.6), point(1, null), point(2, 0.87)],
};

vi.mock('./queries', () => ({
  useSectorCorrelation: () => ({ data, isLoading: false }),
}));

import CorrelationStrip, { seriesPath } from './CorrelationStrip';

afterEach(cleanup);

describe('CorrelationStrip', () => {
  it('shows the regime, when it began, and the current readings', () => {
    render(<CorrelationStrip />);
    expect(screen.getByText('Correlated')).not.toBeNull();
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
});
