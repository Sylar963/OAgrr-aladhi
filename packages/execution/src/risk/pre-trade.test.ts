import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, type RiskLimits } from './limits.js';
import { type CheckContext, checkOrder, isOnTick, type OrderIntent } from './pre-trade.js';

const NOW = 1_760_000_000_000;
const option = {
  name: 'BTC-23OCT26-84000-C',
  kind: 'option' as const,
  underlying: 'BTC',
  active: true,
  tickSize: 5,
  volumeTickSize: 0.01,
  minOrderAmount: 0.1,
};
const intent: OrderIntent = { instrument: option.name, direction: 'buy', amount: 0.5, price: 320 };

function context(overrides: Partial<CheckContext> = {}, limits: Partial<RiskLimits> = {}): CheckContext {
  return {
    instrument: option,
    market: {
      markPrice: 312,
      underlyingPrice: 100_000,
      collarLow: 200,
      collarHigh: 450,
      receivedAt: NOW - 500,
    },
    account: { armed: true, sessionReady: true, openOrders: [], ordersInLastSecond: 0 },
    limits: { ...DEFAULT_LIMITS, ...limits },
    limitsVersion: 'v-test',
    now: NOW,
    ...overrides,
  };
}

function failed(decision: ReturnType<typeof checkOrder>) {
  return decision.checks.filter((c) => !c.passed).map((c) => c.name);
}

describe('checkOrder', () => {
  it('allows a sane order and reports every check with the limits version', () => {
    const decision = checkOrder(intent, context());
    expect(decision.allowed).toBe(true);
    expect(failed(decision)).toEqual([]);
    expect(decision.limitsVersion).toBe('v-test');
    expect(decision.checks.map((c) => c.name)).toEqual([
      'armed',
      'session_ready',
      'valid_numbers',
      'instrument',
      'price_tick',
      'amount_tick',
      'min_amount',
      'market_fresh',
      'collar_vs_mark',
      'collar_venue',
      'order_notional',
      'open_notional',
      'contracts',
      'open_orders',
      'order_rate',
    ]);
  });

  it('blocks when not armed, not reconciled, or the market is stale, even in observe mode', () => {
    const decision = checkOrder(
      intent,
      context(
        {
          account: { armed: false, sessionReady: false, openOrders: [], ordersInLastSecond: 0 },
          market: { ...context().market!, receivedAt: NOW - 60_000 },
        },
        { mode: 'observe' },
      ),
    );
    expect(decision.allowed).toBe(false);
    expect(failed(decision)).toEqual(['armed', 'session_ready', 'market_fresh']);
  });

  it('checks ticks in whole ticks, tolerating float noise but not misalignment', () => {
    expect(isOnTick(0.3, 0.1)).toBe(true);
    expect(isOnTick(84_005, 5)).toBe(true);
    expect(isOnTick(84_003, 5)).toBe(false);
    expect(failed(checkOrder({ ...intent, price: 322 }, context()))).toEqual(['price_tick']);
    expect(failed(checkOrder({ ...intent, amount: 0.505 }, context()))).toEqual(['amount_tick']);
    expect(failed(checkOrder({ ...intent, amount: 0.05 }, context()))).toEqual(['min_amount']);
  });

  it('rejects an unknown or inactive instrument and invalid numbers', () => {
    expect(failed(checkOrder(intent, context({ instrument: null })))).toContain('instrument');
    expect(failed(checkOrder(intent, context({ instrument: { ...option, active: false } })))).toEqual([
      'instrument',
    ]);
    expect(failed(checkOrder({ ...intent, amount: Number.NaN }, context()))).toContain('valid_numbers');
  });

  it('applies our collar on the aggressive side only, and Thalex collar per side', () => {
    expect(failed(checkOrder({ ...intent, price: 365 }, context()))).toEqual(['collar_vs_mark']);
    expect(failed(checkOrder({ ...intent, direction: 'sell', price: 365 }, context()))).toEqual([]);
    expect(failed(checkOrder({ ...intent, direction: 'sell', price: 195 }, context()))).toEqual([
      'collar_vs_mark',
      'collar_venue',
    ]);
  });

  it('lets limit failures through in observe mode but never in enforce', () => {
    const tooBig = { ...intent, amount: 3 };
    const enforced = checkOrder(tooBig, context());
    expect(enforced.allowed).toBe(false);
    expect(failed(enforced)).toEqual(['order_notional', 'contracts']);

    const observed = checkOrder(tooBig, context({}, { mode: 'observe' }));
    expect(observed.allowed).toBe(true);
    expect(failed(observed)).toEqual(failed(enforced));
  });

  it('counts open exposure on the same underlying, kind and side only', () => {
    const openOrders = [
      { kind: 'option' as const, underlying: 'BTC', direction: 'buy' as const, remainingAmount: 4.6 },
      { kind: 'option' as const, underlying: 'BTC', direction: 'sell' as const, remainingAmount: 50 },
      { kind: 'delta1' as const, underlying: 'BTC', direction: 'buy' as const, remainingAmount: 50 },
      { kind: 'option' as const, underlying: 'ETH', direction: 'buy' as const, remainingAmount: 50 },
    ];
    const decision = checkOrder(
      intent,
      context({ account: { armed: true, sessionReady: true, openOrders, ordersInLastSecond: 0 } }),
    );
    expect(failed(decision)).toEqual(['open_notional']);
    expect(decision.checks.find((c) => c.name === 'open_notional')?.detail).toContain('510000');
  });

  it('enforces the open-order count and the order rate', () => {
    const openOrders = Array.from({ length: 10 }, () => ({
      kind: 'delta1' as const,
      underlying: 'ETH',
      direction: 'buy' as const,
      remainingAmount: 0.01,
    }));
    expect(
      failed(
        checkOrder(
          intent,
          context({ account: { armed: true, sessionReady: true, openOrders, ordersInLastSecond: 2 } }),
        ),
      ),
    ).toEqual(['open_orders', 'order_rate']);
  });
});
