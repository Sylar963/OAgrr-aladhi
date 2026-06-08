import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/clerk-token', () => ({ getClerkToken: async () => null }));

import { getPositions, setPaperAccountScope } from './api';

describe('paper api account scope', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ positions: [] }) }),
    );
  });
  afterEach(() => {
    setPaperAccountScope(null);
    vi.unstubAllGlobals();
  });

  it('omits the accountId param when no scope is set', async () => {
    await getPositions();
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).not.toContain('accountId=');
  });

  it('appends the accountId param when a scope is set', async () => {
    setPaperAccountScope('acct_run1');
    await getPositions();
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(url).toContain('accountId=acct_run1');
  });
});
