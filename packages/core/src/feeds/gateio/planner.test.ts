import { describe, expect, it } from 'vitest';
import {
  buildGateioReplayFrames,
  buildGateioSubscribeFrames,
  buildGateioUnsubscribeFrames,
  createGateioSubscriptionState,
  pruneGateioSubscriptionState,
} from './planner.js';

const NOW = () => 1747008000;

describe('Gate.io planner', () => {
  it('builds a contract-ticker subscribe frame for two contracts', () => {
    const state = createGateioSubscriptionState();
    const frames = buildGateioSubscribeFrames(
      state,
      ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      'BTC_USDT',
      NOW,
    );
    expect(frames).toEqual([
      {
        time: 1747008000,
        channel: 'options.contract_tickers',
        event: 'subscribe',
        payload: ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      },
      {
        time: 1747008000,
        channel: 'options.trades',
        event: 'subscribe',
        payload: ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      },
      {
        time: 1747008000,
        channel: 'options.ul_tickers',
        event: 'subscribe',
        payload: ['BTC_USDT'],
      },
    ]);
    expect(state.contracts.has('BTC_USDT-20260626-70000-C')).toBe(true);
    expect(state.underlyings.has('BTC_USDT')).toBe(true);
  });

  it('batches > 50 contracts into multiple frames per channel', () => {
    const state = createGateioSubscriptionState();
    const contracts = Array.from({ length: 130 }, (_, i) => `BTC_USDT-20260626-${i + 1}-C`);
    const frames = buildGateioSubscribeFrames(state, contracts, 'BTC_USDT', NOW);
    const tickerFrames = frames.filter((f) => f.channel === 'options.contract_tickers');
    expect(tickerFrames).toHaveLength(3);
    expect(tickerFrames[0]!.payload.length).toBe(50);
    expect(tickerFrames[2]!.payload.length).toBe(30);
  });

  it('produces replay frames matching tracked state', () => {
    const state = createGateioSubscriptionState();
    buildGateioSubscribeFrames(state, ['BTC_USDT-20260626-70000-C'], 'BTC_USDT', NOW);
    const replay = buildGateioReplayFrames(state, NOW);
    expect(replay.find((f) => f.channel === 'options.contract_tickers')?.payload).toEqual([
      'BTC_USDT-20260626-70000-C',
    ]);
    expect(replay.find((f) => f.channel === 'options.ul_tickers')?.payload).toEqual([
      'BTC_USDT',
    ]);
  });

  it('unsubscribes the right contracts and drops the underlying when empty', () => {
    const state = createGateioSubscriptionState();
    buildGateioSubscribeFrames(state, ['BTC_USDT-20260626-70000-C'], 'BTC_USDT', NOW);
    const frames = buildGateioUnsubscribeFrames(
      state,
      ['BTC_USDT-20260626-70000-C'],
      'BTC_USDT',
      NOW,
    );
    expect(frames.find((f) => f.channel === 'options.contract_tickers')?.payload).toEqual([
      'BTC_USDT-20260626-70000-C',
    ]);
    expect(frames.find((f) => f.channel === 'options.ul_tickers')?.payload).toEqual([
      'BTC_USDT',
    ]);
    expect(state.contracts.size).toBe(0);
    expect(state.underlyings.size).toBe(0);
  });

  it('prunes expired contracts from replay state', () => {
    const state = createGateioSubscriptionState();
    buildGateioSubscribeFrames(
      state,
      ['BTC_USDT-20260626-70000-C', 'BTC_USDT-20260626-70000-P'],
      'BTC_USDT',
      NOW,
    );
    buildGateioSubscribeFrames(state, ['ETH_USDT-20260626-4000-C'], 'ETH_USDT', NOW);

    pruneGateioSubscriptionState(
      state,
      (contract) => contract !== 'BTC_USDT-20260626-70000-C' && contract !== 'ETH_USDT-20260626-4000-C',
    );

    expect(state.contracts.has('BTC_USDT-20260626-70000-C')).toBe(false);
    expect(state.contracts.has('ETH_USDT-20260626-4000-C')).toBe(false);
    expect(state.contractsByUnderlying.get('BTC_USDT')).toEqual(new Set(['BTC_USDT-20260626-70000-P']));
    expect(state.contractsByUnderlying.has('ETH_USDT')).toBe(false);
    expect(state.underlyings.has('BTC_USDT')).toBe(true);
    expect(state.underlyings.has('ETH_USDT')).toBe(false);
  });
});
