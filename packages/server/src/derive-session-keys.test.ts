import { afterEach, describe, expect, it, vi } from 'vitest';

import { PendingDeriveSessionKeys } from './derive-session-keys.js';

describe('PendingDeriveSessionKeys', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues a fresh key per account and keeps only the latest', () => {
    const keys = new PendingDeriveSessionKeys(() => 1_700_000_000_000);
    const first = keys.issue('acct-1');
    const second = keys.issue('acct-1');
    expect(second.publicSessionKey).not.toBe(first.publicSessionKey);
    expect(keys.get('acct-1')?.sessionKey.address).toBe(second.publicSessionKey);
    expect(keys.get('acct-2')).toBeNull();
  });

  it('applies the configured lifetime and IP whitelist', () => {
    vi.stubEnv('DERIVE_SESSION_KEY_TTL_DAYS', '30');
    vi.stubEnv('DERIVE_SESSION_KEY_IP_WHITELIST', '203.0.113.7, 198.51.100.2');
    const grant = new PendingDeriveSessionKeys(() => 1_700_000_000_000).issue('acct-1');
    expect(grant.expirySec).toBe(1_700_000_000 + 30 * 86_400);
    expect(grant.ipWhitelist).toEqual(['203.0.113.7', '198.51.100.2']);
  });

  it('forgets a key that was not confirmed within 15 minutes', () => {
    let now = 1_700_000_000_000;
    const keys = new PendingDeriveSessionKeys(() => now);
    keys.issue('acct-1');
    now += 15 * 60 * 1000 + 1;
    expect(keys.get('acct-1')).toBeNull();
  });
});
