import { describe, expect, it } from 'vitest';
import { EMPTY_GREEKS } from '../../core/types.js';
import type { LiveQuote } from '../shared/sdk-base.js';
import {
  mergeBinanceOiEvent,
  mergeBinanceRestOpenInterest,
  mergeBinanceRestTicker,
} from './state.js';

const previous: LiveQuote = {
  bidPrice: 100,
  askPrice: 110,
  bidSize: 1,
  askSize: 1,
  markPrice: 105,
  lastPrice: 104,
  underlyingPrice: 70_000,
  indexPrice: 70_000,
  volume24h: 10,
  openInterest: 20,
  openInterestUsd: 1_400_000,
  volume24hUsd: 700_000,
  greeks: EMPTY_GREEKS,
  timestamp: 1_000,
};

const safeNum = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

describe('Binance metadata quote merges', () => {
  it('does not refresh executable-price time for OI websocket updates', () => {
    const merged = mergeBinanceOiEvent(
      previous,
      { e: 'openInterest', s: 'BTC-260626-70000-C', o: '21', h: '1470000' },
      safeNum,
    );

    expect(merged).toMatchObject({ openInterest: 21, timestamp: 1_000 });
  });

  it('does not refresh executable-price time for REST ticker updates', () => {
    const merged = mergeBinanceRestTicker(
      previous,
      { symbol: 'BTC-260626-70000-C', volume: '11', lastPrice: '106' },
      safeNum,
    );

    expect(merged).toMatchObject({ volume24h: 11, lastPrice: 106, timestamp: 1_000 });
  });

  it('does not refresh executable-price time for REST OI updates', () => {
    const merged = mergeBinanceRestOpenInterest(
      previous,
      { sumOpenInterest: '22', sumOpenInterestUsd: '1540000' },
      safeNum,
    );

    expect(merged).toMatchObject({ openInterest: 22, timestamp: 1_000 });
  });
});
