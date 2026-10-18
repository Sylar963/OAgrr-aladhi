import { describe, expect, it } from 'vitest';
import { canonicalJson, ExecutionEnvelopeSchema, LiveStatusSchema } from './execution.js';

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('is stable regardless of insertion order', () => {
    expect(canonicalJson({ x: 1, y: 'a' })).toBe(canonicalJson({ y: 'a', x: 1 }));
  });
});

describe('ExecutionEnvelopeSchema', () => {
  const base = {
    command: { type: 'kill', scope: { kind: 'global' }, reason: 'manual' },
    actor: { clerkUserId: 'user_1', accountId: 'acct_1' },
    idempotencyKey: '018f2c4e-8b2a-7c3d-9e4f-0a1b2c3d4e5f',
    nonce: 1,
    ts: 1_760_000_000_000,
    hmac: 'a'.repeat(64),
  };

  it('accepts a well-formed kill', () => {
    expect(ExecutionEnvelopeSchema.safeParse(base).success).toBe(true);
  });

  it('rejects unknown commands and malformed hmacs', () => {
    expect(
      ExecutionEnvelopeSchema.safeParse({ ...base, command: { type: 'withdraw' } }).success,
    ).toBe(false);
    expect(ExecutionEnvelopeSchema.safeParse({ ...base, hmac: 'nothex' }).success).toBe(false);
  });
});

describe('LiveStatusSchema', () => {
  const status = {
    state: 'disarmed',
    killedReason: null,
    keyBound: false,
    venue: { name: 'stub', connected: false },
    alerts: { telegramConfigured: false, emailConfigured: false, testDelivered: false },
    journal: { lastSeq: 0, chainOk: true },
  };

  it('reads a status from a daemon that predates per-environment keys as holding none', () => {
    expect(LiveStatusSchema.parse(status).tradingKeys).toEqual([]);
  });

  it('carries each held trading key by environment', () => {
    const parsed = LiveStatusSchema.parse({
      ...status,
      keyBound: true,
      tradingKeys: [{ environment: 'test', kidHint: 'a1b2', venueAccount: 'A0001' }],
    });
    expect(parsed.tradingKeys).toEqual([
      { environment: 'test', kidHint: 'a1b2', venueAccount: 'A0001' },
    ]);
    expect(() =>
      LiveStatusSchema.parse({
        ...status,
        tradingKeys: [{ environment: 'staging', kidHint: 'x', venueAccount: 'A' }],
      }),
    ).toThrow();
  });
});
