import type { CryptoSectorCorrelationResponse } from '@oggregator/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import CorrelationMatrix from './CorrelationMatrix';

const sector = (id: string, name: string, decoupled = false) => ({
  id,
  name,
  corrBtc: 0.8,
  betaBtc: 1,
  intraCorr: 0.5,
  meanCorr: 0.6,
  gapZ: decoupled ? -3 : 0,
  decoupled,
});

const data: CryptoSectorCorrelationResponse = {
  asOf: 1,
  barSec: 300,
  windowBars: 24,
  thresholds: { correlated: 0.8, dispersed: 0.5 },
  regime: 'mixed',
  regimeSince: null,
  current: null,
  change1h: null,
  baseline: { mean: null, std: null, windows: 0 },
  zScore: null,
  sectorIds: ['majors', 'memes', 'rwa'],
  views: [
    {
      windowBars: 24,
      matrix: [
        [1, 0.71, 0.12],
        [0.71, 1, 0.05],
        [0.12, 0.05, 1],
      ],
      residualMatrix: [
        [1, 0.33, -0.2],
        [0.33, 1, -0.1],
        [-0.2, -0.1, 1],
      ],
      corrBtc: [0.91, 0.6, 0.07],
    },
    {
      windowBars: 288,
      matrix: [
        [1, 0.88, 0.3],
        [0.88, 1, 0.25],
        [0.3, 0.25, 1],
      ],
      residualMatrix: [
        [1, 0.4, 0],
        [0.4, 1, 0],
        [0, 0, 1],
      ],
      corrBtc: [0.95, 0.8, 0.4],
    },
  ],
  sectors: [sector('majors', 'Majors'), sector('memes', 'Memes'), sector('rwa', 'RWA', true)],
  timeline: [],
};

afterEach(cleanup);

describe('CorrelationMatrix', () => {
  it('switches window and basis, and marks decoupling sectors', () => {
    render(<CorrelationMatrix data={data} />);
    expect(screen.getAllByText('0.71')).toHaveLength(2);
    expect(screen.getByText('0.91')).not.toBeNull();
    expect(screen.getByTitle('Majors × Memes: 0.71')).not.toBeNull();
    expect(screen.getByLabelText('Decoupling from the other sectors')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ex-BTC' }));
    expect(screen.getAllByText('0.33')).toHaveLength(2);
    expect(screen.getAllByText('-0.20')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '24h' }));
    expect(screen.getAllByText('0.40')).toHaveLength(3);
    expect(screen.getByText('0.95')).not.toBeNull();
  });
});
