import { describe, expect, it } from 'vitest';
import { fmtPrice, fmtStrike, fmtStrikeShort, fmtUsdCompact, fmtUsdPrice } from './format';

describe('price formatting across underlying scales', () => {
  it('keeps four significant digits below $1,000 and drops cents above it', () => {
    expect(fmtPrice(81_521.43)).toBe('81,521');
    expect(fmtPrice(104.95)).toBe('104.95');
    expect(fmtPrice(9.97)).toBe('9.97');
    expect(fmtPrice(1.30539)).toBe('1.305');
    expect(fmtPrice(0.08014)).toBe('0.08014');
    expect(fmtPrice(0.000012345)).toBe('0.00001235');
    expect(fmtUsdPrice(-0.0061)).toBe('-$0.0061');
  });

  it('prints strikes exactly instead of rounding listed values together', () => {
    expect(fmtStrike(0.0725)).toBe('0.0725');
    expect(fmtStrike(1.175)).toBe('1.175');
    expect(fmtStrike(0.1 + 0.2)).toBe('0.3');
    expect(fmtStrike(80_250)).toBe('80,250');
    expect(fmtStrikeShort(80_500)).toBe('80.5k');
    expect(fmtStrikeShort(0.08)).toBe('0.08');
  });

  it('compacts large USD values and keeps sub-dollar ones readable', () => {
    expect(fmtUsdCompact(2_400_000)).toBe('$2.4M');
    expect(fmtUsdCompact(1_500)).toBe('$1.5K');
    expect(fmtUsdCompact(250)).toBe('$250');
    expect(fmtUsdCompact(5.25)).toBe('$5.25');
    expect(fmtUsdCompact(0.0061)).toBe('$0.0061');
    expect(fmtUsdCompact(0)).toBe('$0');
  });
});
