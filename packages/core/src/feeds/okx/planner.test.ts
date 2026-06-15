import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildOkxChainSubscriptionArgs,
  buildOkxInstrumentSubscriptionArgs,
  buildOkxReplayArgs,
  buildOkxUnsubscribeArgs,
  createOkxSubscriptionState,
  markOkxSubscribed,
  removeOkxSubscribedFamily,
  removeOkxSubscribedInstruments,
  resetOkxSubscriptionState,
} from './planner.js';

function createInstrument(exchangeSymbol: string, base = 'BTC'): CachedInstrument {
  return {
    symbol: `${base}/USD:${exchangeSymbol}`,
    exchangeSymbol,
    base,
    quote: 'USD',
    settle: base,
    expiry: '2026-03-28',
    strike: 60_000,
    right: 'call',
    inverse: true,
    contractSize: 0.01,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

describe('OKX planner', () => {
  it('builds family, ticker, and mark-price subscriptions for a chain', () => {
    const state = createOkxSubscriptionState();
    const plan = buildOkxChainSubscriptionArgs(state, 'BTC', [
      createInstrument('BTC-USD-260328-60000-C'),
    ]);

    expect(plan.args).toEqual([
      { channel: 'opt-summary', instFamily: 'BTC-USD' },
      { channel: 'tickers', instId: 'BTC-USD-260328-60000-C' },
      { channel: 'mark-price', instId: 'BTC-USD-260328-60000-C' },
    ]);
    expect(state.subscribedFamilies.size).toBe(0);
    expect(state.subscribedTickers.size).toBe(0);
    expect(state.subscribedMarkPrice.size).toBe(0);
  });

  it('does not build synthetic family subscriptions when no instruments match', () => {
    const state = createOkxSubscriptionState();

    expect(buildOkxChainSubscriptionArgs(state, 'AVAX_USDC', []).args).toEqual([]);
  });

  it('adds only instrument-level subscriptions for newly listed contracts', () => {
    const state = createOkxSubscriptionState();
    const plan = buildOkxInstrumentSubscriptionArgs(state, [
      createInstrument('BTC-USD-260328-65000-C'),
    ]);

    expect(plan.args).toEqual([
      { channel: 'tickers', instId: 'BTC-USD-260328-65000-C' },
      { channel: 'mark-price', instId: 'BTC-USD-260328-65000-C' },
    ]);
  });

  it('replays and unsubscribes from all tracked subscriptions', () => {
    const state = createOkxSubscriptionState();
    markOkxSubscribed(
      state,
      buildOkxChainSubscriptionArgs(state, 'BTC', [createInstrument('BTC-USD-260328-60000-C')]),
    );
    markOkxSubscribed(
      state,
      buildOkxInstrumentSubscriptionArgs(state, [
        createInstrument('ETH-USD-260328-3000-C', 'ETH'),
      ]),
    );

    expect(buildOkxReplayArgs(state)).toEqual(buildOkxUnsubscribeArgs(state));
  });

  it('resets tracked subscriptions', () => {
    const state = createOkxSubscriptionState();
    markOkxSubscribed(
      state,
      buildOkxChainSubscriptionArgs(state, 'BTC', [createInstrument('BTC-USD-260328-60000-C')]),
    );
    resetOkxSubscriptionState(state);

    expect(state.subscribedFamilies.size).toBe(0);
    expect(state.subscribedTickers.size).toBe(0);
    expect(state.subscribedMarkPrice.size).toBe(0);
  });

  it('marks subscriptions only after subscribe succeeds', () => {
    const state = createOkxSubscriptionState();
    const plan = buildOkxChainSubscriptionArgs(state, 'BTC', [
      createInstrument('BTC-USD-260328-60000-C'),
    ]);

    markOkxSubscribed(state, plan);

    expect(state.subscribedFamilies.has('BTC-USD')).toBe(true);
    expect(state.subscribedTickers.has('BTC-USD-260328-60000-C')).toBe(true);
    expect(state.subscribedMarkPrice.has('BTC-USD-260328-60000-C')).toBe(true);
  });

  it('removes families and instruments from local replay state', () => {
    const state = createOkxSubscriptionState();
    const plan = buildOkxChainSubscriptionArgs(state, 'BTC', [
      createInstrument('BTC-USD-260328-60000-C'),
    ]);
    markOkxSubscribed(state, plan);

    removeOkxSubscribedFamily(state, 'BTC-USD');
    removeOkxSubscribedInstruments(state, ['BTC-USD-260328-60000-C']);

    expect(state.subscribedFamilies.has('BTC-USD')).toBe(false);
    expect(state.subscribedTickers.has('BTC-USD-260328-60000-C')).toBe(false);
    expect(state.subscribedMarkPrice.has('BTC-USD-260328-60000-C')).toBe(false);
  });
});
