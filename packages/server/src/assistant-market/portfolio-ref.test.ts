import { describe, expect, it } from 'vitest';

import { PORTFOLIO_REF_TTL_MS, PortfolioRefStore } from './portfolio-ref.js';

const SCOPE = {
  accountId: 'user-1',
  source: 'thalex' as const,
  underlying: 'BTC',
  generatedAt: 1_000,
};

describe('PortfolioRefStore', () => {
  it('mints opaque refs that resolve to the server-side scope', () => {
    const store = new PortfolioRefStore({ now: () => 0 });
    const ref = store.mint(SCOPE);

    expect(ref).toMatch(/^pref_[A-Za-z0-9_-]{22}$/);
    expect(ref).not.toContain('user-1');
    expect(store.mint(SCOPE)).not.toBe(ref);
    expect(store.resolve(ref)).toEqual({
      ok: true,
      scope: { ...SCOPE, expiresAt: PORTFOLIO_REF_TTL_MS },
    });
  });

  it('rejects refs after the 15 minute TTL', () => {
    let now = 0;
    const store = new PortfolioRefStore({ now: () => now });
    const ref = store.mint(SCOPE);

    now = PORTFOLIO_REF_TTL_MS - 1;
    expect(store.resolve(ref).ok).toBe(true);
    now = PORTFOLIO_REF_TTL_MS;
    expect(store.resolve(ref)).toEqual({ ok: false, error: 'expired' });
    expect(store.resolve(ref)).toEqual({ ok: false, error: 'unknown' });
  });

  it('rejects unknown and tampered refs', () => {
    const store = new PortfolioRefStore();
    const ref = store.mint(SCOPE);
    const last = ref.at(-1) === 'A' ? 'B' : 'A';

    expect(store.resolve(`${ref.slice(0, -1)}${last}`)).toEqual({ ok: false, error: 'unknown' });
    expect(store.resolve('pref_')).toEqual({ ok: false, error: 'unknown' });
    expect(store.resolve('user-1')).toEqual({ ok: false, error: 'unknown' });
    expect(store.resolve(`${ref} `)).toEqual({ ok: false, error: 'unknown' });
  });

  it('evicts the least recently used ref beyond capacity', () => {
    const store = new PortfolioRefStore({ maxEntries: 2 });
    const first = store.mint(SCOPE);
    const second = store.mint(SCOPE);
    expect(store.resolve(first).ok).toBe(true);
    store.mint(SCOPE);

    expect(store.size).toBe(2);
    expect(store.resolve(first).ok).toBe(true);
    expect(store.resolve(second)).toEqual({ ok: false, error: 'unknown' });
  });
});
