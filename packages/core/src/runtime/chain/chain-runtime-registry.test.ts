import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WsSubscriptionRequest } from '../../core/types.js';
import { ChainRuntime } from './chain-runtime.js';
import { ChainRuntimeRegistry } from './chain-runtime-registry.js';

const fetchOptionChainMock = vi.fn();

vi.mock('../../core/registry.js', () => ({
  getAdapter: (venue: string) => ({ venue, fetchOptionChain: fetchOptionChainMock }),
  getRegisteredVenues: () => ['okx'],
}));

function request(): WsSubscriptionRequest {
  return { underlying: 'BTC', expiry: '2026-03-27', venues: ['okx'] };
}

// Stub coordinator so runtime.ready() never touches the network — acquire
// resolves a no-op release handle.
function stubCoordinator() {
  return { acquire: vi.fn(async () => ({ release: async () => {} })) };
}

// Comfortably past the idle TTL — asserts that abandoned runtimes are reclaimed
// within minutes, without coupling the test to the exact tuned value.
const WELL_PAST_TTL_MS = 20 * 60 * 1000;

beforeEach(() => {
  fetchOptionChainMock.mockResolvedValue(undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fetchOptionChainMock.mockReset();
});

describe('ChainRuntimeRegistry idle cleanup', () => {
  it('reclaims a runtime once it has been idle past the TTL', async () => {
    const disposeSpy = vi.spyOn(ChainRuntime.prototype, 'dispose');
    const registry = new ChainRuntimeRegistry({ coordinator: stubCoordinator() as never });
    registry.start();

    const { release } = await registry.acquire(request());
    await release();

    await vi.advanceTimersByTimeAsync(WELL_PAST_TTL_MS);

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    await registry.dispose();
  });

  it('keeps a runtime that still has an active consumer', async () => {
    const disposeSpy = vi.spyOn(ChainRuntime.prototype, 'dispose');
    const registry = new ChainRuntimeRegistry({ coordinator: stubCoordinator() as never });
    registry.start();

    // Acquire and never release — refCount stays > 0 (mirrors a pinned warm-tier runtime).
    await registry.acquire(request());

    await vi.advanceTimersByTimeAsync(WELL_PAST_TTL_MS);

    expect(disposeSpy).not.toHaveBeenCalled();
    await registry.dispose();
  });
});
