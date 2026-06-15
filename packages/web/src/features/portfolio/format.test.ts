import { describe, expect, it } from 'vitest';

import { fmtNum, fmtUsdSigned } from './format';

describe('fmtUsdSigned', () => {
  it('prefixes gains with +', () => {
    expect(fmtUsdSigned(400)).toBe('+$400');
    expect(fmtUsdSigned(50)).toBe('+$50.00');
  });

  it('prefixes losses with - and never drops the minus', () => {
    // Regression: a negative total (loss / short vega / theta decay) must read as
    // a loss, not a phantom gain. fmtUsdSigned formats Math.abs(value), so the
    // sign has to be carried explicitly.
    expect(fmtUsdSigned(-400)).toBe('-$400');
    expect(fmtUsdSigned(-50)).toBe('-$50.00');
    expect(fmtUsdSigned(-0.5)).toBe('-$0.5000');
    expect(fmtUsdSigned(-1234).startsWith('-$')).toBe(true);
    expect(fmtUsdSigned(-1234)).not.toContain('+');
  });

  it('renders flat zero as +$0.00', () => {
    expect(fmtUsdSigned(0)).toBe('+$0.00');
  });

  it('renders nullish / non-finite as an em dash', () => {
    expect(fmtUsdSigned(null)).toBe('—');
    expect(fmtUsdSigned(undefined)).toBe('—');
    expect(fmtUsdSigned(Number.NaN)).toBe('—');
  });
});

describe('fmtNum', () => {
  it('signs values without doubling or dropping the minus', () => {
    expect(fmtNum(2.5)).toBe('+2.50');
    expect(fmtNum(-2.5)).toBe('-2.50');
    expect(fmtNum(0)).toBe('+0.00');
  });
});
