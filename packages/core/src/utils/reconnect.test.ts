import { describe, expect, it } from 'vitest';
import { backoffDelay, flapBackoffDelay } from './reconnect.js';

describe('backoffDelay', () => {
  it('grows exponentially and caps at maxMs', () => {
    expect(backoffDelay(0, 1_000, 30_000)).toBeGreaterThanOrEqual(1_000);
    expect(backoffDelay(0, 1_000, 30_000)).toBeLessThan(1_300);
    expect(backoffDelay(20, 1_000, 30_000)).toBe(30_000);
  });
});

describe('flapBackoffDelay', () => {
  it('returns 0 for a non-positive streak (no penalty)', () => {
    expect(flapBackoffDelay(0)).toBe(0);
    expect(flapBackoffDelay(-1)).toBe(0);
  });

  it('doubles per consecutive short session and caps at maxMs', () => {
    expect(flapBackoffDelay(1)).toBe(15_000);
    expect(flapBackoffDelay(2)).toBe(30_000);
    expect(flapBackoffDelay(3)).toBe(60_000);
    expect(flapBackoffDelay(4)).toBe(120_000);
    expect(flapBackoffDelay(5)).toBe(120_000);
  });
});
