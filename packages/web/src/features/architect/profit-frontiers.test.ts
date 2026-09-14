import { describe, expect, it } from 'vitest';

import type { Leg } from './payoff';
import { computeLongCallProfitFrontiers } from './profit-frontiers';

const DAY_MS = 86_400_000;

function longCall(overrides: Partial<Leg> = {}): Leg {
  return {
    id: 'call',
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry: '2026-12-18',
    quantity: 1,
    entryPrice: 10,
    venue: 'deribit',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: 0.5,
    ...overrides,
  };
}

describe('computeLongCallProfitFrontiers', () => {
  it('moves the required price toward the expiry break-even as time decays', () => {
    const [frontier] = computeLongCallProfitFrontiers(
      [longCall()],
      0,
      30 * DAY_MS,
      86_400,
      0,
    );

    expect(frontier).toBeDefined();
    expect(frontier!.points[0]!.price).toBeLessThan(110);
    expect(frontier!.points.at(-1)!.price).toBeCloseTo(110, 8);
    for (let index = 1; index < frontier!.points.length; index++) {
      expect(frontier!.points[index]!.price).toBeGreaterThanOrEqual(
        frontier!.points[index - 1]!.price,
      );
    }
  });

  it('shows that higher IV requires less underlying price before expiry', () => {
    const [base, higherIv] = computeLongCallProfitFrontiers(
      [longCall()],
      0,
      30 * DAY_MS,
      86_400,
      10,
    );

    expect(higherIv!.iv).toBeCloseTo(0.6, 8);
    expect(higherIv!.points[0]!.price).toBeLessThan(base!.points[0]!.price);
    expect(higherIv!.points.at(-1)!.price).toBeCloseTo(base!.points.at(-1)!.price, 8);
  });

  it('shows that lower IV requires more underlying price before expiry', () => {
    const [base, lowerIv] = computeLongCallProfitFrontiers(
      [longCall()],
      0,
      30 * DAY_MS,
      86_400,
      -10,
    );

    expect(lowerIv!.points[0]!.price).toBeGreaterThan(base!.points[0]!.price);
  });

  it('only returns frontiers for one long call with a future expiry', () => {
    expect(
      computeLongCallProfitFrontiers(
        [longCall({ direction: 'sell' })],
        0,
        30 * DAY_MS,
        86_400,
        10,
      ),
    ).toEqual([]);
    expect(
      computeLongCallProfitFrontiers(
        [longCall(), longCall({ id: 'second' })],
        0,
        30 * DAY_MS,
        86_400,
        10,
      ),
    ).toEqual([]);
    expect(computeLongCallProfitFrontiers([longCall()], DAY_MS, DAY_MS, 86_400, 10)).toEqual([]);
  });
});
