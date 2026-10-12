import { describe, expect, it, vi } from 'vitest';

import { fetchClerkUsername } from './clerk-users.js';

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('fetchClerkUsername', () => {
  it('returns the username from the Clerk user record', async () => {
    const fetchFn = respond(200, { id: 'user_1', username: 'aladhi' });
    await expect(fetchClerkUsername('user_1', 'sk_test', fetchFn)).resolves.toBe('aladhi');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.clerk.com/v1/users/user_1',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk_test' } }),
    );
  });

  it('distinguishes a missing username from a failed lookup', async () => {
    await expect(
      fetchClerkUsername('user_1', 'sk', respond(200, { username: null })),
    ).resolves.toBeNull();
    await expect(fetchClerkUsername('user_1', 'sk', respond(500, {}))).resolves.toBeUndefined();
    await expect(
      fetchClerkUsername('user_1', undefined, respond(200, {})),
    ).resolves.toBeUndefined();
  });
});
