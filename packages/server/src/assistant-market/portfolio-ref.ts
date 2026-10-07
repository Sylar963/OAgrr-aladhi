import { randomBytes } from 'node:crypto';

import type { PortfolioSource } from '@oggregator/protocol';

export interface PortfolioRefScope {
  accountId: string;
  source: PortfolioSource;
  underlying: string | null;
  generatedAt: number;
  expiresAt: number;
}

export type PortfolioRefResolution =
  | { ok: true; scope: PortfolioRefScope }
  | { ok: false; error: 'unknown' | 'expired' };

export interface PortfolioRefStoreOptions {
  ttlMs?: number;
  /** Absolute lifetime from minting; sliding renewals never extend a ref past it. */
  maxLifetimeMs?: number;
  maxEntries?: number;
  now?: () => number;
  /** True while a chat run that carries the ref is in flight; such a ref is renewed even past its TTL. */
  isActive?: (ref: string) => boolean;
}

export const PORTFOLIO_REF_TTL_MS = 15 * 60_000;
export const PORTFOLIO_REF_MAX_LIFETIME_MS = 60 * 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;
const REF_PREFIX = 'pref_';
const REF_PATTERN = /^pref_[A-Za-z0-9_-]{22}$/;

interface Entry {
  scope: PortfolioRefScope;
  mintedAt: number;
}

/**
 * In-memory, process-local map from an opaque token to the server-side portfolio
 * scope it was minted for. Tokens are never persisted, so a restart revokes them.
 * Each successful resolve slides the expiry forward by the TTL, up to the absolute lifetime.
 */
export class PortfolioRefStore {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxLifetimeMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly isActive: (ref: string) => boolean;

  constructor(options: PortfolioRefStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? PORTFOLIO_REF_TTL_MS;
    this.maxLifetimeMs = Math.max(this.ttlMs, options.maxLifetimeMs ?? PORTFOLIO_REF_MAX_LIFETIME_MS);
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    this.isActive = options.isActive ?? (() => false);
  }

  mint(scope: Omit<PortfolioRefScope, 'expiresAt'>): string {
    const ref = `${REF_PREFIX}${randomBytes(16).toString('base64url')}`;
    const now = this.now();
    this.entries.set(ref, { scope: { ...scope, expiresAt: now + this.ttlMs }, mintedAt: now });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return ref;
  }

  resolve(ref: string): PortfolioRefResolution {
    if (!REF_PATTERN.test(ref)) return { ok: false, error: 'unknown' };
    const entry = this.entries.get(ref);
    if (entry == null) return { ok: false, error: 'unknown' };
    const now = this.now();
    const hardExpiry = entry.mintedAt + this.maxLifetimeMs;
    const live = now < entry.scope.expiresAt || this.isActive(ref);
    if (!live || now >= hardExpiry) {
      this.entries.delete(ref);
      return { ok: false, error: 'expired' };
    }
    const scope = { ...entry.scope, expiresAt: Math.min(now + this.ttlMs, hardExpiry) };
    this.entries.delete(ref);
    this.entries.set(ref, { scope, mintedAt: entry.mintedAt });
    return { ok: true, scope };
  }

  get size(): number {
    return this.entries.size;
  }
}
