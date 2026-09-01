import type { EnrichedSide } from '@shared/enriched';
import { useStrategyStore } from '@features/architect/strategy-store';
import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import QuickTrade from './QuickTrade';

const SELL_PUT_SIDE = {
  venues: {
    tastytrade: {
      bid: 4.2,
      ask: 4.5,
      mid: 4.35,
      bidSize: 12,
      askSize: 8,
      markIv: 0.24,
      bidIv: null,
      askIv: null,
      delta: -0.31,
      gamma: 0.02,
      theta: -0.08,
      vega: 0.12,
      spreadPct: 6.9,
      totalCost: null,
      estimatedFees: null,
      openInterest: 120,
      volume24h: 35,
      openInterestUsd: null,
      volume24hUsd: null,
    },
  },
  bestIv: 0.24,
  bestVenue: 'tastytrade',
} as unknown as EnrichedSide;

afterEach(() => {
  cleanup();
  useStrategyStore.getState().replaceLegs([], '');
  useAppStore.setState({ activeTab: 'chain', tradfiPage: 'chain' });
});

describe('QuickTrade', () => {
  it('adds a TradFi sell put and opens the TradFi Builder', () => {
    useAppStore.setState({ activeTab: 'architect', tradfiPage: 'chain' });

    render(
      <QuickTrade
        strike={380}
        type="put"
        direction="sell"
        side={SELL_PUT_SIDE}
        activeVenues={['tastytrade']}
        underlying="SPY"
        expiry="2026-09-18"
        builderMode="tradfi"
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '+ Builder' }));

    expect(useAppStore.getState().tradfiPage).toBe('builder');
    expect(useStrategyStore.getState()).toMatchObject({
      underlying: 'SPY',
      legs: [
        expect.objectContaining({
          type: 'put',
          direction: 'sell',
          strike: 380,
          expiry: '2026-09-18',
          venue: 'tastytrade',
          entryPrice: 4.2,
        }),
      ],
    });
  });
});
