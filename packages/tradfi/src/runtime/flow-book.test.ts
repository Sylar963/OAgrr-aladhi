import { describe, expect, it } from 'vitest';
import { classifyTrade, etDayKey, TradfiFlowBook } from './flow-book.js';

// 2026-06-16 11:00 ET and 2026-06-17 11:00 ET (15:00Z, EDT = UTC-4).
const DAY1 = Date.parse('2026-06-16T15:00:00Z');
const DAY2 = Date.parse('2026-06-17T15:00:00Z');

describe('classifyTrade (Lee-Ready)', () => {
  it('quote rule: above mid is a buy, below mid is a sell', () => {
    expect(classifyTrade(1.6, 1.0, 2.0, null, 1)).toBe(1);
    expect(classifyTrade(1.4, 1.0, 2.0, null, 1)).toBe(-1);
  });

  it('at-mid falls back to the tick rule', () => {
    expect(classifyTrade(1.5, 1.0, 2.0, 1.4, -1)).toBe(1); // uptick vs last
    expect(classifyTrade(1.5, 1.0, 2.0, 1.6, 1)).toBe(-1); // downtick vs last
  });

  it('zero tick carries the prior direction', () => {
    expect(classifyTrade(1.5, 1.0, 2.0, 1.5, -1)).toBe(-1);
  });

  it('no quote uses the tick rule', () => {
    expect(classifyTrade(2.0, null, null, 1.0, 1)).toBe(1);
  });
});

describe('TradfiFlowBook', () => {
  it('accumulates signed customer flow (buys positive, sells negative)', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('SPX-C-5000', 1.6, 10, 1.0, 2.0, DAY1); // buy +10
    book.recordTrade('SPX-C-5000', 1.4, 4, 1.0, 2.0, DAY1); //  sell −4
    expect(book.netFlowFor('SPX-C-5000')).toBe(6);
  });

  it('ignores null/non-positive size or null price', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('X', null, 10, 1, 2, DAY1);
    book.recordTrade('X', 1.6, null, 1, 2, DAY1);
    book.recordTrade('X', 1.6, 0, 1, 2, DAY1);
    expect(book.netFlowFor('X')).toBe(0);
  });

  it('clears all flow on ET-day rollover', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('X', 1.6, 10, 1.0, 2.0, DAY1);
    expect(book.netFlowFor('X')).toBe(10);
    book.recordTrade('Y', 1.6, 3, 1.0, 2.0, DAY2); // new session → wipes X
    expect(book.netFlowFor('X')).toBe(0);
    expect(book.netFlowFor('Y')).toBe(3);
  });

  it('etDayKey returns an ET calendar day', () => {
    expect(etDayKey(DAY1)).toBe('2026-06-16');
  });

  it('carries last tick direction across zero-tick trades at mid', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('Z', 1.5, 5, 1.0, 2.0, DAY1); // at mid, no prior tick → default +1 buy
    book.recordTrade('Z', 1.5, 5, 1.0, 2.0, DAY1); // at mid, zero tick → inherits +1
    expect(book.netFlowFor('Z')).toBe(10);
  });

  it('resetSession clears flow and size', () => {
    const book = new TradfiFlowBook();
    book.recordTrade('A', 1.8, 5, 1.0, 2.0, DAY1);
    expect(book.size()).toBe(1);
    book.resetSession();
    expect(book.netFlowFor('A')).toBe(0);
    expect(book.size()).toBe(0);
  });
});
