import { describe, expect, it, vi } from 'vitest';
import type { WsSubscriptionRequest } from '../../core/types.js';
import { ChainRuntimeRegistry } from './chain-runtime-registry.js';

function request(overrides: Partial<WsSubscriptionRequest> = {}): WsSubscriptionRequest {
  return {
    underlying: 'BTC',
    expiry: '2026-03-27',
    venues: ['okx'],
    ...overrides,
  };
}

describe('ChainRuntimeRegistry', () => {
  it('tracks active and background references separately', async () => {
    const ready = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    const registry = new ChainRuntimeRegistry({
      createRuntime: () => ({ ready, dispose }) as never,
    });

    const warmHandle = await registry.acquire(request(), { activity: 'background' });
    const activeHandle = await registry.acquire(request());

    expect(ready).toHaveBeenCalledTimes(2);
    expect(registry.listActivity()).toEqual([
      expect.objectContaining({
        request: request(),
        refCount: 2,
        activeRefCount: 1,
        coverageTier: 'active',
      }),
    ]);

    await activeHandle.release();
    expect(registry.listActivity()).toEqual([
      expect.objectContaining({
        request: request(),
        refCount: 1,
        activeRefCount: 0,
        coverageTier: 'hot',
      }),
    ]);

    await warmHandle.release();
    expect(registry.listActivity()).toEqual([
      expect.objectContaining({
        request: request(),
        refCount: 0,
        activeRefCount: 0,
        coverageTier: 'hot',
      }),
    ]);

    await registry.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('emits activity changes for acquire and release transitions', async () => {
    const onActivityChange = vi.fn();
    const registry = new ChainRuntimeRegistry({
      createRuntime: () => ({ ready: async () => {}, dispose: async () => {} }) as never,
      onActivityChange,
    });

    const handle = await registry.acquire(request({ underlying: 'LTC' }), { activity: 'background' });
    await handle.release();

    expect(onActivityChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        request: request({ underlying: 'LTC' }),
        refCount: 1,
        activeRefCount: 0,
        coverageTier: 'cold',
      }),
    );
    expect(onActivityChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        request: request({ underlying: 'LTC' }),
        refCount: 0,
        activeRefCount: 0,
        coverageTier: 'cold',
      }),
    );
  });
});
