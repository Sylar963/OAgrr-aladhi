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
  maxEntries?: number;
  now?: () => number;
}

export const PORTFOLIO_REF_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_ENTRIES = 1_000;
const REF_PREFIX = 'pref_';
const REF_PATTERN = /^pref_[A-Za-z0-9_-]{22}$/;

/**
 * In-memory, process-local map from an opaque token to the server-side portfolio
 * scope it was minted for. Tokens are never persisted, so a restart revokes them.
 */
export class PortfolioRefStore {
  private readonly entries = new Map<string, PortfolioRefScope>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: PortfolioRefStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? PORTFOLIO_REF_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  mint(scope: Omit<PortfolioRefScope, 'expiresAt'>): string {
    const ref = `${REF_PREFIX}${randomBytes(16).toString('base64url')}`;
    this.entries.set(ref, { ...scope, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return ref;
  }

  resolve(ref: string): PortfolioRefResolution {
    if (!REF_PATTERN.test(ref)) return { ok: false, error: 'unknown' };
    const scope = this.entries.get(ref);
    if (scope == null) return { ok: false, error: 'unknown' };
    if (this.now() >= scope.expiresAt) {
      this.entries.delete(ref);
      return { ok: false, error: 'expired' };
    }
    this.entries.delete(ref);
    this.entries.set(ref, scope);
    return { ok: true, scope };
  }

  get size(): number {
    return this.entries.size;
  }
}
