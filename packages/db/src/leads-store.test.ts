import { describe, expect, it } from 'vitest';
import { NoopLeadsStore } from './leads-store.js';

describe('NoopLeadsStore', () => {
  it('is disabled and no-ops', async () => {
    const store = new NoopLeadsStore();
    expect(store.enabled).toBe(false);
    await expect(store.captureLead({ email: 'a@b.co', source: 'hero' })).resolves.toBeNull();
    await expect(store.dispose()).resolves.toBeUndefined();
  });
});
