import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectVenue } from './api';

describe('portfolio venue connections API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a successful venue connection response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ venue: 'thalex', configured: true, connected: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      connectVenue('thalex', { kid: 'kid', privateKeyPem: 'private-key' }, 'token'),
    ).resolves.toEqual({ venue: 'thalex', configured: true, connected: true });
  });
});
