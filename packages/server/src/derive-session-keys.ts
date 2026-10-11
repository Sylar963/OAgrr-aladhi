import { generateDeriveSessionKey, type DeriveSessionKeyPair } from '@oggregator/core';
import type { DeriveSessionKeyGrant } from '@oggregator/protocol';

const DEFAULT_TTL_DAYS = 90;
const PENDING_TTL_MS = 15 * 60 * 1000;
const SESSION_KEY_LABEL = 'oggregator read-only';

export interface PendingDeriveSessionKey {
  sessionKey: DeriveSessionKeyPair;
  grant: DeriveSessionKeyGrant;
  createdAtMs: number;
}

function sessionKeyTtlDays(): number {
  const raw = Number(process.env['DERIVE_SESSION_KEY_TTL_DAYS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_DAYS;
}

function sessionKeyIpWhitelist(): string[] {
  return (process.env['DERIVE_SESSION_KEY_IP_WHITELIST'] ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);
}

// The private half never leaves the server: the browser only learns the public
// address, which the owner's wallet then registers with Derive as a read-only key.
export class PendingDeriveSessionKeys {
  private readonly pending = new Map<string, PendingDeriveSessionKey>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(accountId: string): DeriveSessionKeyGrant {
    this.prune();
    const sessionKey = generateDeriveSessionKey();
    const createdAtMs = this.now();
    const grant: DeriveSessionKeyGrant = {
      publicSessionKey: sessionKey.address,
      expirySec: Math.floor(createdAtMs / 1000) + Math.round(sessionKeyTtlDays() * 86_400),
      ipWhitelist: sessionKeyIpWhitelist(),
      label: SESSION_KEY_LABEL,
    };
    this.pending.set(accountId, { sessionKey, grant, createdAtMs });
    return grant;
  }

  get(accountId: string): PendingDeriveSessionKey | null {
    const entry = this.pending.get(accountId);
    if (entry == null) return null;
    if (this.now() - entry.createdAtMs > PENDING_TTL_MS) {
      this.pending.delete(accountId);
      return null;
    }
    return entry;
  }

  consume(accountId: string): void {
    this.pending.delete(accountId);
  }

  private prune(): void {
    const cutoff = this.now() - PENDING_TTL_MS;
    for (const [accountId, entry] of this.pending) {
      if (entry.createdAtMs < cutoff) this.pending.delete(accountId);
    }
  }
}

export const pendingDeriveSessionKeys = new PendingDeriveSessionKeys();
