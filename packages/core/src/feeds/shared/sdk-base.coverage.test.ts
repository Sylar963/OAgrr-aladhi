import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SURFACE_COVERAGE,
  SdkBaseAdapter,
  type CachedInstrument,
  type SurfaceCoverageConfig,
} from './sdk-base.js';
import type { StreamHandlers } from './types.js';
import type { VenueId } from '../../types/common.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const DAY = 86_400_000;

function instrument(base: string, daysOut: number, strike: number): CachedInstrument {
  const expiryTs = NOW + daysOut * DAY;
  const expiry = new Date(expiryTs).toISOString().slice(0, 10);
  return {
    symbol: `${base}/USD:USDT-${expiry}-${strike}-C`,
    exchangeSymbol: `${base}-${expiry}-${strike}-C`,
    base,
    quote: 'USDT',
    settle: 'USDT',
    expiry,
    expirationTimestamp: expiryTs,
    strike,
    right: 'call',
    inverse: false,
    contractSize: 1,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

// Listing shaped like the live BTC/ETH chains: dailies, weeklies, monthlies,
// quarterlies beyond 120d, plus an alt underlying.
const LISTING: CachedInstrument[] = [
  ...[1, 2, 3, 5, 12, 26, 54, 84, 117, 175, 266, 357].flatMap((d) => [
    instrument('BTC', d, 60_000),
    instrument('BTC', d, 70_000),
  ]),
  ...[1, 5, 26, 84, 175].map((d) => instrument('ETH', d, 2_400)),
  ...[1, 5, 26].map((d) => instrument('SOL', d, 150)),
];

class CoverageAdapter extends SdkBaseAdapter {
  readonly venue: VenueId = 'bybit';
  readonly subscribed: string[] = [];
  readonly unsubscribed: string[] = [];
  failOnce = new Set<string>();

  constructor(coverage: SurfaceCoverageConfig | null) {
    super();
    this.surfaceCoverage = coverage;
  }

  protected initClients(): void {}
  protected async fetchInstruments(): Promise<CachedInstrument[]> {
    return LISTING;
  }
  protected async subscribeChain(underlying: string, expiry: string): Promise<void> {
    const key = `${underlying}:${expiry}`;
    if (this.failOnce.delete(key)) throw new Error('subscribe timed out');
    this.subscribed.push(key);
  }
  protected override async unsubscribeChain(underlying: string, expiry: string): Promise<void> {
    this.unsubscribed.push(`${underlying}:${expiry}`);
  }
  protected async unsubscribeAll(): Promise<void> {}

  pinned(): string[] {
    return [...this.pinnedChainKeys].sort();
  }
  runCoverage(): Promise<void> {
    return this.ensureSurfaceCoverage();
  }
}

const handlers = (): StreamHandlers => ({ onDelta: vi.fn(), onStatus: vi.fn() });

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// loadMarkets starts coverage in the background; let that run finish.
async function load(coverage: SurfaceCoverageConfig | null): Promise<CoverageAdapter> {
  const adapter = new CoverageAdapter(coverage);
  await adapter.loadMarkets();
  await settle();
  return adapter;
}

function distinct(keys: string[]): string[] {
  return [...new Set(keys)].sort();
}

describe('SdkBaseAdapter surface coverage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('before: on-demand venues only quote the 3 nearest expiries per underlying', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const adapter = await load(null);

    const btc = distinct(adapter.subscribed).filter((k) => k.startsWith('BTC:'));
    expect(btc).toHaveLength(3);
    expect(adapter.pinned()).toEqual([]);
    await adapter.dispose();
  });

  it('after: pins every BTC/ETH expiry inside 120d and nothing beyond it', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const adapter = await load(DEFAULT_SURFACE_COVERAGE);

    const pinnedBtc = adapter.pinned().filter((k) => k.startsWith('BTC:'));
    const pinnedEth = adapter.pinned().filter((k) => k.startsWith('ETH:'));
    expect(pinnedBtc).toHaveLength(9); // 1d … 117d
    expect(pinnedEth).toHaveLength(4); // 1d, 5d, 26d, 84d
    expect(adapter.pinned().some((k) => k.startsWith('SOL:'))).toBe(false);

    const subscribed = distinct(adapter.subscribed);
    for (const key of adapter.pinned()) expect(subscribed).toContain(key);
    expect(subscribed).not.toContain(`BTC:${instrument('BTC', 175, 1).expiry}`);
    await adapter.dispose();
  });

  it('keeps a pinned chain subscribed after the last client releases it', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const adapter = await load(DEFAULT_SURFACE_COVERAGE);
    const far = instrument('BTC', 84, 1).expiry;
    const beyond = instrument('BTC', 266, 1).expiry;

    const releasePinned = await adapter.subscribe(
      { underlying: 'BTC', expiry: far, venues: ['bybit'] },
      handlers(),
    );
    const releaseUnpinned = await adapter.subscribe(
      { underlying: 'BTC', expiry: beyond, venues: ['bybit'] },
      handlers(),
    );
    await releasePinned();
    await releaseUnpinned();

    expect(adapter.unsubscribed).toEqual([`BTC:${beyond}`]);
    await adapter.dispose();
  });

  it('retries a failed coverage subscribe on the next refresh and drops expired pins', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const flaky = `BTC:${instrument('BTC', 54, 1).expiry}`;
    const fresh = new CoverageAdapter(DEFAULT_SURFACE_COVERAGE);
    fresh.failOnce.add(flaky);
    await fresh.loadMarkets();
    await settle();
    expect(fresh.pinned().length).toBeGreaterThan(0);
    expect(fresh.pinned()).not.toContain(flaky);
    await fresh.runCoverage();
    expect(fresh.pinned()).toContain(flaky);

    vi.setSystemTime(NOW + 2 * DAY);
    await fresh.runCoverage();
    expect(fresh.pinned()).not.toContain(`BTC:${instrument('BTC', 1, 1).expiry}`);

    await fresh.dispose();
  });
});
