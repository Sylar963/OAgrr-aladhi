import { describe, expect, it } from 'vitest';
import { BaseAdapter } from './base.js';
import type { VenueCapabilities } from './types.js';
import type { VenueId } from '../../types/common.js';

class TestAdapter extends BaseAdapter {
  readonly venue: VenueId = 'binance';
  readonly capabilities: VenueCapabilities = {
    optionChain: true,
    greeks: true,
    websocket: true,
  };

  async loadMarkets(): Promise<void> {}
  async listUnderlyings(): Promise<string[]> {
    return [];
  }
  async listExpiries(): Promise<string[]> {
    return [];
  }
  async fetchOptionChain(): Promise<never> {
    throw new Error('not implemented');
  }

  public parse(value: unknown): number | null {
    return this.safeNum(value);
  }

  public iv(value: unknown): number | null {
    return this.ivToFraction(value);
  }
}

describe('BaseAdapter.safeNum', () => {
  const adapter = new TestAdapter();

  it('returns null for empty strings', () => {
    expect(adapter.parse('')).toBeNull();
    expect(adapter.parse('   ')).toBeNull();
  });

  it('returns null for nullish values', () => {
    expect(adapter.parse(null)).toBeNull();
    expect(adapter.parse(undefined)).toBeNull();
  });

  it('still parses valid numeric strings and numbers', () => {
    expect(adapter.parse('1.25')).toBe(1.25);
    expect(adapter.parse(42)).toBe(42);
  });
});

describe('BaseAdapter.ivToFraction', () => {
  const adapter = new TestAdapter();

  it('returns null for missing IV instead of 0%', () => {
    // Number(null) === 0 is finite, so without the guard a missing IV would
    // surface as 0% rather than blank.
    expect(adapter.iv(null)).toBeNull();
    expect(adapter.iv(undefined)).toBeNull();
    expect(adapter.iv('')).toBeNull();
    expect(adapter.iv('  ')).toBeNull();
  });

  it('converts percentage values to fractions', () => {
    expect(adapter.iv('50.18')).toBeCloseTo(0.5018);
    expect(adapter.iv(50.18)).toBeCloseTo(0.5018);
  });

  it('preserves a genuine zero', () => {
    expect(adapter.iv(0)).toBe(0);
  });
});
