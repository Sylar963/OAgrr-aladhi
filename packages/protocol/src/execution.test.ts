import { describe, expect, it } from 'vitest';
import { canonicalJson, ExecutionEnvelopeSchema } from './execution.js';

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
