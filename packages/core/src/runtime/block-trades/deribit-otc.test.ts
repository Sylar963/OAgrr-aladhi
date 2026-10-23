import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeribitOtcBlockAssembler,
  type DeribitTapeLeg,
  groupDeribitOtcPage,
  mapDeribitOtcBlock,
  parseDeribitOtcLegs,
} from './deribit-otc.js';

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/deribit-otc-tape.json', import.meta.url), 'utf8'),
) as { trades: unknown[] };

const legs = parseDeribitOtcLegs(fixture.trades);
const legsOf = (blockId: string): DeribitTapeLeg[] =>
  legs.filter((leg) => leg.block_trade_id === blockId);

describe('parseDeribitOtcLegs', () => {
  it('keeps OTC block legs and drops Block RFQ fills and screen trades', () => {
    expect(legs).toHaveLength(5);
    expect(new Set(legs.map((leg) => leg.block_trade_id))).toEqual(
      new Set(['BLOCK-303469', 'BLOCK-303477', 'BLOCK-303481']),
    );
  });
});

describe('mapDeribitOtcBlock', () => {
  it('maps a combo block with its strategy, USD leg prices and credit direction', () => {
    const block = mapDeribitOtcBlock(legsOf('BLOCK-303469'))!;

    expect(block).toMatchObject({
      venue: 'deribit',
      source: 'otc',
      tradeId: 'BLOCK-303469',
      underlying: 'BTC',
      strategy: 'PUT_CALENDAR_SPREAD',
      direction: 'sell',
      totalSize: 50,
      indexPrice: 82828.26,
    });
    expect(block.legs.map((leg) => [leg.instrument, leg.direction, leg.ratio])).toEqual([
      ['BTC-30OCT26-76000-P', 'sell', 1],
      ['BTC-23OCT26-76000-P', 'buy', 1],
    ]);
    expect(block.legs[0]!.price).toBeCloseTo(0.0019 * 82828.26, 6);
    expect(block.notionalUsd).toBeCloseTo(100 * 82828.26, 2);
  });

  it('reduces unequal leg amounts to a block unit with integer ratios', () => {
    const block = mapDeribitOtcBlock(legsOf('BLOCK-303481'))!;

    expect(block.strategy).toBe('CUSTOM');
    expect(block.direction).toBe('buy');
    expect(block.totalSize).toBe(50);
    expect(block.legs.map((leg) => [leg.instrument, leg.size, leg.ratio])).toEqual([
      ['BTC-30OCT26-83000-C', 50, 1],
      ['BTC-27NOV26-93000-C', 50, 2],
    ]);
    expect(block.notionalUsd).toBeCloseTo(150 * 82251.99, 2);
  });

  it('maps a single-leg block without a strategy', () => {
    const block = mapDeribitOtcBlock(legsOf('BLOCK-303477'))!;

    expect(block.strategy).toBeNull();
    expect(block.direction).toBe('buy');
    expect(block.totalSize).toBe(25);
  });

  it('keeps linear USDC option prices in USD', () => {
    const [leg] = legsOf('BLOCK-303477');
    const block = mapDeribitOtcBlock([
      { ...leg!, instrument_name: 'SOL_USDC-30OCT26-200-C', price: 4.5 },
    ])!;

    expect(block.underlying).toBe('SOL');
    expect(block.legs[0]!.price).toBe(4.5);
  });
});

describe('DeribitOtcBlockAssembler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a block once all of its legs have arrived', () => {
    const emit = vi.fn();
    const assembler = new DeribitOtcBlockAssembler(emit);
    const [first, second] = legsOf('BLOCK-303469');

    expect(assembler.push([first!])).toEqual([]);
    const completed = assembler.push([second!]);

    expect(completed.map((block) => block.tradeId)).toEqual(['BLOCK-303469']);
    expect(completed[0]!.legs).toHaveLength(2);
    assembler.dispose();
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits option legs after the grace window when hedge legs never arrive', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const assembler = new DeribitOtcBlockAssembler(emit, 1_000);
    const hedged = legsOf('BLOCK-303469').map((leg) => ({ ...leg, block_trade_leg_count: 3 }));

    expect(assembler.push(hedged)).toEqual([]);
    vi.advanceTimersByTime(1_000);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0][0].legs).toHaveLength(2);
  });

  it('drops pending blocks on dispose', () => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const assembler = new DeribitOtcBlockAssembler(emit, 1_000);

    assembler.push([legsOf('BLOCK-303469')[0]!]);
    assembler.dispose();
    vi.advanceTimersByTime(5_000);

    expect(emit).not.toHaveBeenCalled();
  });
});

describe('groupDeribitOtcPage', () => {
  it('drops a partial block cut off at the oldest edge of the page', () => {
    const page = [...legsOf('BLOCK-303481'), legsOf('BLOCK-303469')[0]!];

    expect(groupDeribitOtcPage(page).map((block) => block.tradeId)).toEqual(['BLOCK-303481']);
  });
});
