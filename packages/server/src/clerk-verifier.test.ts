import { describe, expect, it, vi } from 'vitest';
import { parseFactorVerificationAge, verifyClerkTokenWith } from './clerk-verifier.js';

describe('verifyClerkTokenWith', () => {
  it('returns null for an empty token without calling verify', async () => {
    const verify = vi.fn();
    const result = await verifyClerkTokenWith('', verify);
    expect(result).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it('maps a valid payload to identity fields', async () => {
    const verify = vi.fn().mockResolvedValue({
      payload: { sub: 'user_123', email: 'a@b.co', name: 'Alice' },
    });
    const result = await verifyClerkTokenWith('tok', verify);
    expect(result).toEqual({
      clerkUserId: 'user_123',
      email: 'a@b.co',
      displayName: 'Alice',
      factorAgeMinutes: { first: null, second: null },
    });
  });

  it('returns null when verify throws (invalid signature / expired)', async () => {
    const verify = vi.fn().mockRejectedValue(new Error('signature verification failed'));
    const result = await verifyClerkTokenWith('bad', verify);
    expect(result).toBeNull();
  });

  it('returns null when payload has no sub claim', async () => {
    const verify = vi.fn().mockResolvedValue({ payload: { email: 'a@b.co' } });
    const result = await verifyClerkTokenWith('tok', verify);
    expect(result).toBeNull();
  });

  it('rejects a token whose azp is not an allowed origin', async () => {
    const verify = vi.fn().mockResolvedValue({
      payload: { sub: 'user_123', azp: 'https://evil.example' },
    });
    expect(await verifyClerkTokenWith('tok', verify, ['https://oggregator.xyz'])).toBeNull();
  });

  it('accepts a token whose azp is an allowed origin', async () => {
    const verify = vi.fn().mockResolvedValue({
      payload: { sub: 'user_123', azp: 'https://oggregator.xyz' },
    });
    const result = await verifyClerkTokenWith('tok', verify, ['https://oggregator.xyz']);
    expect(result?.clerkUserId).toBe('user_123');
  });

  it('accepts a token without azp', async () => {
    const verify = vi.fn().mockResolvedValue({ payload: { sub: 'user_123' } });
    const result = await verifyClerkTokenWith('tok', verify, ['https://oggregator.xyz']);
    expect(result?.clerkUserId).toBe('user_123');
  });

  it('rejects a non-string azp', async () => {
    const verify = vi.fn().mockResolvedValue({ payload: { sub: 'user_123', azp: 42 } });
    expect(await verifyClerkTokenWith('tok', verify, ['https://oggregator.xyz'])).toBeNull();
  });
});

describe('parseFactorVerificationAge', () => {
  it.each([
    [undefined, { first: null, second: null }],
    ['7,3', { first: null, second: null }],
    [[-1, -1], { first: null, second: null }],
    [[7, -1], { first: 7, second: null }],
    [[7, 3], { first: 7, second: 3 }],
    [[0, 0], { first: 0, second: 0 }],
    [[Number.NaN, '3'], { first: null, second: null }],
  ])('parses %j', (fva, expected) => {
    expect(parseFactorVerificationAge(fva)).toEqual(expected);
  });
});
