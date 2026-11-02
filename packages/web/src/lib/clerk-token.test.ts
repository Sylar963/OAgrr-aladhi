import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getClerkToken, setClerkTokenGetter } from './clerk-token';

const never = () => new Promise<string | null>(() => {});

describe('getClerkToken', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setClerkTokenGetter(null);
    vi.useRealTimers();
  });

  it('returns null with no getter registered', async () => {
    await expect(getClerkToken()).resolves.toBeNull();
  });

  it('returns the token from the getter', async () => {
    setClerkTokenGetter(async () => 'token');
    await expect(getClerkToken()).resolves.toBe('token');
  });

  it('returns null when the getter rejects', async () => {
    setClerkTokenGetter(async () => {
      throw new Error('no session');
    });
    await expect(getClerkToken()).resolves.toBeNull();
  });

  it('stops waiting when Clerk never settles', async () => {
    setClerkTokenGetter(never);
    const token = getClerkToken();

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(token).resolves.toBeNull();
  });

  it('does not make later calls wait once Clerk has stalled', async () => {
    setClerkTokenGetter(never);
    const first = getClerkToken();
    await vi.advanceTimersByTimeAsync(2_000);
    await first;

    await expect(getClerkToken()).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for tokens again after a stalled Clerk recovers', async () => {
    let settle: (value: string) => void = () => {};
    setClerkTokenGetter(() => new Promise<string>((resolve) => (settle = resolve)));
    const stalledCall = getClerkToken();
    await vi.advanceTimersByTimeAsync(2_000);
    await stalledCall;

    settle('late');
    await vi.advanceTimersByTimeAsync(0);

    const next = getClerkToken();
    settle('fresh');
    await expect(next).resolves.toBe('fresh');
  });

  it('leaves no timer behind on the normal path', async () => {
    setClerkTokenGetter(async () => 'token');
    await getClerkToken();
    expect(vi.getTimerCount()).toBe(0);
  });
});
