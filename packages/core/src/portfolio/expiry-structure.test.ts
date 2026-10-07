import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { analyzeExpiryStructure } from './expiry-structure.js';
import type { MarkContext } from './types.js';

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const SPOT = 84_000;

function leg(
  legId: string,
  expiry: string,
  strike: number,
  optionRight: PositionLeg['optionRight'],
  size: number,
  entryPriceUsd: number,
): PositionLeg {
  return {
    legId,
    underlying: 'BTC',
    expiry,
    strike,
    optionRight,
    size,
    entryPriceUsd,
    entryIv: 0.5,
    entryTs: NOW,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
  };
}

function mark(iv: number | null = 0.5): MarkContext {
  return {
    underlyingPriceUsd: SPOT,
    forwardPriceUsd: SPOT,
    markPriceUsd: 1_000,
    iv,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    yearsToExpiry: null,
  };
}

function withMarks(legs: PositionLeg[]) {
  return legs.map((item) => ({ leg: item, mark: mark() }));
}

describe('analyzeExpiryStructure', () => {
  it('flags the window after the long call expires when the later short call is uncovered', () => {
    const windows = analyzeExpiryStructure(
      withMarks([
        leg('long-oct16', '2026-10-16', 87_000, 'call', 1, 1_050),
        leg('short-oct30', '2026-10-30', 85_000, 'call', -1, 3_031.95),
      ]),
      NOW,
    );

    expect(windows).toHaveLength(2);
    const [first, second] = windows ?? [];
    expect(first).toMatchObject({
      from: '2026-10-07T12:00:00.000Z',
      until: '2026-10-16',
      liveLegIds: ['long-oct16', 'short-oct30'],
      netCallSize: 0,
      upsideUnbounded: false,
    });
    expect(first?.worstLossUsd).toBeLessThan(0);
    expect(second).toMatchObject({
      from: '2026-10-16',
      until: '2026-10-30',
      liveLegIds: ['short-oct30'],
      netCallSize: -1,
      upsideUnbounded: true,
      worstLossUsd: null,
      worstLossSpotUsd: null,
    });
    expect(second?.lossAtZeroSpotUsd).toBeCloseTo(-1_050 + 3_031.95, 6);
  });

  it('bounds a put diagonal at its zero-spot loss', () => {
    const windows = analyzeExpiryStructure(
      withMarks([
        leg('short-put-oct16', '2026-10-16', 84_000, 'put', -1, 2_500),
        leg('long-put-oct30', '2026-10-30', 80_000, 'put', 1, 1_500),
      ]),
      NOW,
    );

    // Net credit 1,000 minus the 4,000 strike gap once both puts are worth their strike.
    const handWorstLossUsd = 2_500 - 1_500 - (84_000 - 80_000);
    expect(windows).toHaveLength(2);
    for (const window of windows ?? []) {
      expect(window.upsideUnbounded).toBe(false);
      expect(window.lossAtZeroSpotUsd).toBeCloseTo(handWorstLossUsd, 6);
      expect(window.worstLossUsd).toBeCloseTo(handWorstLossUsd, 6);
      expect(window.worstLossSpotUsd).toBe(0);
    }
  });

  it('treats a longer-dated long call as cover for a shorter-dated short call', () => {
    const windows = analyzeExpiryStructure(
      withMarks([
        leg('short-oct16', '2026-10-16', 85_000, 'call', -1, 2_000),
        leg('long-oct30', '2026-10-30', 85_000, 'call', 1, 3_000),
      ]),
      NOW,
    );

    expect(windows?.map((window) => window.netCallSize)).toEqual([0, 1]);
    expect(windows?.every((window) => !window.upsideUnbounded)).toBe(true);
    for (const window of windows ?? []) {
      expect(window.worstLossUsd).toBeCloseTo(-1_000, 4);
    }
  });

  it('flags partial cover when the later long call is smaller than the short', () => {
    const windows = analyzeExpiryStructure(
      withMarks([
        leg('short-oct16', '2026-10-16', 85_000, 'call', -1, 2_000),
        leg('long-oct30', '2026-10-30', 85_000, 'call', 0.5, 3_000),
      ]),
      NOW,
    );

    expect(windows?.[0]).toMatchObject({ netCallSize: -0.5, upsideUnbounded: true, worstLossUsd: null });
    // The Oct 16 settlement is uncapped, so the cumulative loss at Oct 30 is too.
    expect(windows?.[1]).toMatchObject({ netCallSize: 0.5, upsideUnbounded: true, worstLossUsd: null });
  });

  it('keeps later windows unbounded after an uncovered short call settles', () => {
    const windows = analyzeExpiryStructure(
      withMarks([
        leg('long-put-oct30', '2026-10-30', 80_000, 'put', 1, 1_450),
        leg('short-call-nov27', '2026-11-27', 95_000, 'call', -1, 1_600),
        leg('long-call-dec25', '2026-12-25', 90_000, 'call', 0.5, 4_100),
      ]),
      NOW,
    );

    expect(windows?.map((window) => window.netCallSize)).toEqual([-0.5, -0.5, 0.5]);
    expect(windows?.map((window) => window.upsideUnbounded)).toEqual([true, true, true]);
    expect(windows?.[2]).toMatchObject({ liveLegIds: ['long-call-dec25'], worstLossUsd: null, worstLossSpotUsd: null });
  });

  it('settles already-expired legs without opening a window for them', () => {
    const windows = analyzeExpiryStructure(
      withMarks([
        leg('expired', '2026-10-02', 80_000, 'call', 1, 500),
        leg('live', '2026-10-30', 90_000, 'call', -1, 1_000),
      ]),
      NOW,
    );

    expect(windows).toHaveLength(1);
    expect(windows?.[0]).toMatchObject({ until: '2026-10-30', liveLegIds: ['live'], upsideUnbounded: true });
  });

  it('returns null when a later leg has no volatility to reprice it', () => {
    const windows = analyzeExpiryStructure(
      [
        { leg: leg('a', '2026-10-16', 85_000, 'call', 1, 1_000), mark: mark() },
        { leg: { ...leg('b', '2026-10-30', 85_000, 'call', -1, 2_000), entryIv: null }, mark: mark(null) },
      ],
      NOW,
    );

    expect(windows).toBeNull();
  });
});
