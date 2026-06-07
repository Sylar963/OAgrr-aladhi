import { describe, expect, it, vi } from 'vitest';
import { verifyClerkTokenWith } from './clerk-verifier.js';

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
    expect(result).toEqual({ clerkUserId: 'user_123', email: 'a@b.co', displayName: 'Alice' });
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
});
