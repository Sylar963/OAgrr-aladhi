import { describe, expect, it } from 'vitest';

import { AssistantRunRegistry } from './assistant-run-registry.js';
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

  it('rejects refs left unused for the 15 minute TTL', () => {
    let now = 0;
    const store = new PortfolioRefStore({ now: () => now });
    const ref = store.mint(SCOPE);

    now = PORTFOLIO_REF_TTL_MS;
    expect(store.resolve(ref)).toEqual({ ok: false, error: 'expired' });
    expect(store.resolve(ref)).toEqual({ ok: false, error: 'unknown' });
  });

  it('slides the expiry forward on each successful resolve, up to the absolute lifetime', () => {
    let now = 0;
    const store = new PortfolioRefStore({ now: () => now, maxLifetimeMs: 3 * PORTFOLIO_REF_TTL_MS });
    const ref = store.mint(SCOPE);

    now = PORTFOLIO_REF_TTL_MS - 1;
    expect(store.resolve(ref)).toMatchObject({ ok: true, scope: { expiresAt: 2 * PORTFOLIO_REF_TTL_MS - 1 } });
    now = 2 * PORTFOLIO_REF_TTL_MS - 2;
    expect(store.resolve(ref)).toMatchObject({ ok: true, scope: { expiresAt: 3 * PORTFOLIO_REF_TTL_MS - 2 } });
    now = 3 * PORTFOLIO_REF_TTL_MS - 3;
    expect(store.resolve(ref)).toMatchObject({ ok: true, scope: { expiresAt: 3 * PORTFOLIO_REF_TTL_MS } });
    now = 3 * PORTFOLIO_REF_TTL_MS;
    expect(store.resolve(ref)).toEqual({ ok: false, error: 'expired' });
  });

  it('keeps a ref alive past its TTL while its chat run is active', () => {
    let now = 0;
    const runs = new AssistantRunRegistry({ now: () => now, ttlMs: 2 * PORTFOLIO_REF_TTL_MS });
    const store = new PortfolioRefStore({ now: () => now, isActive: (ref) => runs.isRefActive(ref) });
    const ref = store.mint(SCOPE);
    runs.begin({ requestId: 'req-1', userIdHash: 'u', threadId: 't', portfolioRef: ref });

    now = PORTFOLIO_REF_TTL_MS + 1;
    expect(store.resolve(ref)).toMatchObject({ ok: true, scope: { expiresAt: 2 * PORTFOLIO_REF_TTL_MS + 1 } });
    runs.finish('req-1');
    now = 2 * PORTFOLIO_REF_TTL_MS + 1;
    expect(store.resolve(ref)).toEqual({ ok: false, error: 'expired' });
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
