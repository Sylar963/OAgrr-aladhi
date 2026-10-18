import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, RiskLimitBook, RiskLimitsSchema } from './limits.js';

const owner = { clerkUserId: 'user_1', accountId: 'acct_1' };
const other = { clerkUserId: 'user_2', accountId: 'acct_2' };

function book() {
  return new RiskLimitBook(mkdtempSync(join(tmpdir(), 'ogg-limits-')));
}

function writeOverride(limits: RiskLimitBook, actor: typeof owner, body: unknown) {
  const path = limits.pathFor(actor);
  writeFileSync(path, JSON.stringify(body), { mode: 0o600 });
  return path;
}

describe('RiskLimitBook', () => {
  it('gives every actor the defaults, with a stable version', () => {
    const limits = book();
    const first = limits.limitsFor(owner);
    expect(first).toMatchObject({ limits: DEFAULT_LIMITS, source: 'default' });
    expect(limits.limitsFor(other).version).toBe(first.version);
    expect(RiskLimitsSchema.parse(DEFAULT_LIMITS)).toEqual(DEFAULT_LIMITS);
  });

  it('applies a per-actor override to that actor only', () => {
    const limits = book();
    writeOverride(limits, owner, { maxOpenOrders: 20, collarPct: { option: 10 } });

    const mine = limits.limitsFor(owner);
    expect(mine.source).toBe('override');
    expect(mine.limits.maxOpenOrders).toBe(20);
    expect(mine.limits.collarPct).toEqual({ option: 10, delta1: DEFAULT_LIMITS.collarPct.delta1 });
    expect(mine.version).not.toBe(limits.limitsFor(other).version);
    expect(limits.limitsFor(other).source).toBe('default');
  });

  it('never lets an override exceed 80% of a Thalex cap', () => {
    const limits = book();
    writeOverride(limits, owner, { maxOpenOrders: 161 });
    expect(() => limits.limitsFor(owner)).toThrow();

    writeOverride(limits, owner, { maxOpenNotionalPerSideUsd: { delta1: 800_001 } });
    expect(() => limits.limitsFor(owner)).toThrow();

    writeOverride(limits, owner, { maxOpenOrders: 160, maxOpenNotionalPerSideUsd: { option: 1_600_000 } });
    expect(limits.limitsFor(owner).limits.maxOpenOrders).toBe(160);
  });

  it('fails closed on an unknown field or a readable file', () => {
    const limits = book();
    writeOverride(limits, owner, { maxLeverage: 100 });
    expect(() => limits.limitsFor(owner)).toThrow();

    const path = writeOverride(limits, owner, { maxOpenOrders: 5 });
    chmodSync(path, 0o644);
    expect(() => limits.limitsFor(owner)).toThrow(/accessible to other users/);
  });
});
