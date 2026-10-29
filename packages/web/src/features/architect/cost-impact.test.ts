import { describe, expect, it } from 'vitest';

import { debitSplit, spreadImpact } from './cost-impact';

describe('spreadImpact', () => {
  it('flags a spread that eats most of the max profit', () => {
    const impact = spreadImpact(4.75, 17);

    expect(impact?.maxProfitAtMid).toBeCloseTo(21.75);
    expect(impact?.share).toBeCloseTo(17 / 21.75);
    expect(impact?.severity).toBe('severe');
  });

  it('warns between the warn and severe shares', () => {
    expect(spreadImpact(15, 5)?.severity).toBe('warn');
  });

  it('stays quiet for a small spread', () => {
    expect(spreadImpact(18.35, 3.4)?.severity).toBe('ok');
  });

  it('is severe when no profit is left at bid/ask', () => {
    const impact = spreadImpact(-2, 10);

    expect(impact?.severity).toBe('severe');
    expect(impact?.maxProfitAfterSpread).toBe(-2);
  });

  it('has no profit share when even mid cannot profit', () => {
    expect(spreadImpact(-12, 2)?.share).toBe(Infinity);
  });

  it('skips unbounded profit and zero spread', () => {
    expect(spreadImpact(null, 5)).toBeNull();
    expect(spreadImpact(10, 0)).toBeNull();
  });
});

describe('debitSplit', () => {
  it('splits an ITM-wing iron fly debit into the guaranteed part and the risk', () => {
    const split = debitSplit(-78.25, -28.25);

    expect(split?.debit).toBeCloseTo(78.25);
    expect(split?.guaranteedBack).toBeCloseTo(50);
    expect(split?.atRisk).toBeCloseTo(28.25);
  });

  it('skips a plain debit that can be lost in full', () => {
    expect(debitSplit(-500, -500)).toBeNull();
  });

  it('skips credits and unbounded loss', () => {
    expect(debitSplit(50, -950)).toBeNull();
    expect(debitSplit(-100, null)).toBeNull();
  });
});
