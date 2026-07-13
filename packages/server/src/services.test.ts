import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutated per-test to control which services succeed or fail.
// Declared before vi.mock because the factory closes over this object;
// Vitest evaluates the factory lazily on re-import, after the variable exists.
const startResolves = { dvol: true, spot: true, flow: true, ivHistory: true };
let getSurfaceGrid: ((underlying: string) => Promise<unknown[]>) | null = null;
const originalDatabaseUrl = process.env['DATABASE_URL'];
const originalSnapshotsEnabled = process.env['SHORT_STRADDLE_SNAPSHOTS_ENABLED'];
const originalSnapshotCachePath = process.env['SHORT_STRADDLE_SNAPSHOT_CACHE_PATH'];

vi.mock('@oggregator/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@oggregator/core')>();
  return {
    ...real,
    // Arrow functions are not `new`-compatible — use class syntax so services.ts
    // can call `new DvolService()` etc. without a "not a constructor" error.
    DvolService: class {
      start() {
        return startResolves.dvol ? Promise.resolve() : Promise.reject(new Error('dvol boom'));
      }
      dispose() {}
      getSnapshot() {
        return null;
      }
      getAllSnapshots() {
        return [];
      }
    },
    SpotRuntime: class {
      start() {
        return startResolves.spot ? Promise.resolve() : Promise.reject(new Error('spot boom'));
      }
      dispose() {}
      getSnapshot() {
        return null;
      }
    },
    TradeRuntime: class {
      start() {
        return startResolves.flow ? Promise.resolve() : Promise.reject(new Error('flow boom'));
      }
      dispose() {}
      acquire() {
        return Promise.resolve(() => {});
      }
      getTrades() {
        return [];
      }
    },
    BlockTradeRuntime: class {
      start() {
        return Promise.resolve();
      }
      dispose() {}
      getTrades() {
        return [];
      }
      getHealth() {
        return [];
      }
    },
    IvHistoryService: class {
      constructor(options: { getSurfaceGrid: (underlying: string) => Promise<unknown[]> }) {
        getSurfaceGrid = options.getSurfaceGrid;
      }
      start() {
        return startResolves.ivHistory
          ? Promise.resolve()
          : Promise.reject(new Error('iv history boom'));
      }
      dispose() {}
    },
    buildIvSurfaceGrid: vi.fn(() => Promise.resolve([])),
  };
});

describe('bootstrapServices — readiness transitions', () => {
  // vi.resetModules() gives each test a fresh serviceHealth={false,false,false}.
  // The vi.mock registration persists across resets, so re-importing services.js
  // still uses the mocked classes with the current startResolves values.
  beforeEach(() => {
    startResolves.dvol = true;
    startResolves.spot = true;
    startResolves.flow = true;
    startResolves.ivHistory = true;
    getSurfaceGrid = null;
    delete process.env['DATABASE_URL'];
    delete process.env['SHORT_STRADDLE_SNAPSHOTS_ENABLED'];
    delete process.env['SHORT_STRADDLE_SNAPSHOT_CACHE_PATH'];
    vi.resetModules();
  });

  afterAll(() => {
    restoreEnv('DATABASE_URL', originalDatabaseUrl);
    restoreEnv('SHORT_STRADDLE_SNAPSHOTS_ENABLED', originalSnapshotsEnabled);
    restoreEnv('SHORT_STRADDLE_SNAPSHOT_CACHE_PATH', originalSnapshotCachePath);
  });

  it('marks all services ready after all start() calls resolve', async () => {
    const { bootstrapServices, isDvolReady, isSpotReady, isFlowReady, isIvHistoryReady } =
      await import('./services.js');

    await bootstrapServices({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger);

    expect(isDvolReady()).toBe(true);
    expect(isSpotReady()).toBe(true);
    expect(isFlowReady()).toBe(true);
    expect(isIvHistoryReady()).toBe(true);
  });

  it('all services are not ready before bootstrapServices is called', async () => {
    const { isDvolReady, isSpotReady, isFlowReady, isIvHistoryReady } = await import(
      './services.js'
    );
    expect(isDvolReady()).toBe(false);
    expect(isSpotReady()).toBe(false);
    expect(isFlowReady()).toBe(false);
    expect(isIvHistoryReady()).toBe(false);
  });

  it('leaves flow as not ready when flow start() rejects', async () => {
    startResolves.flow = false;
    const { bootstrapServices, isDvolReady, isSpotReady, isFlowReady } = await import(
      './services.js'
    );

    await bootstrapServices({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger);

    expect(isDvolReady()).toBe(true);
    expect(isSpotReady()).toBe(true);
    expect(isFlowReady()).toBe(false);
  });

  it('logs a warning (not throws) when a service fails', async () => {
    startResolves.dvol = false;
    const { bootstrapServices } = await import('./services.js');
    const infoFn = vi.fn();
    const warnFn = vi.fn();
    const log = { info: infoFn, warn: warnFn } as unknown as FastifyBaseLogger;

    await expect(bootstrapServices(log)).resolves.toBeUndefined();
    expect(warnFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.stringContaining('dvol boom') }),
      expect.any(String),
    );
  });

  it('logs a summary including elapsed time', async () => {
    const { bootstrapServices } = await import('./services.js');
    const infoFn = vi.fn();
    const log = { info: infoFn, warn: vi.fn() } as unknown as FastifyBaseLogger;
    await bootstrapServices(log);

    const summaryCall = infoFn.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'object' && args[0] !== null && 'ms' in (args[0] as object),
    );
    expect(summaryCall).toBeDefined();
    expect((summaryCall![0] as { ms: number }).ms).toBeGreaterThanOrEqual(0);
  });

  it('does not create or invoke a collector when snapshots are disabled', async () => {
    const { shortStraddleSnapshotService } = await import('./services.js');

    expect(shortStraddleSnapshotService).toBeNull();
    if (getSurfaceGrid == null) throw new Error('IV surface callback not registered');
    await expect(getSurfaceGrid('BTC')).resolves.toEqual([]);
  });

  it('disables collection and warns when enabled without DATABASE_URL', async () => {
    process.env['SHORT_STRADDLE_SNAPSHOTS_ENABLED'] = 'true';
    vi.resetModules();
    const { bootstrapServices, shortStraddleSnapshotService } = await import('./services.js');
    const warn = vi.fn();

    await bootstrapServices({ info: vi.fn(), warn } as unknown as FastifyBaseLogger);

    expect(shortStraddleSnapshotService).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      { reason: 'DATABASE_URL missing' },
      'short-straddle snapshot collection disabled',
    );
  });

  it('keeps IV history processing alive when the collector throws', async () => {
    process.env['DATABASE_URL'] = 'postgres://test:test@localhost:5432/test';
    process.env['SHORT_STRADDLE_SNAPSHOTS_ENABLED'] = 'true';
    process.env['SHORT_STRADDLE_SNAPSHOT_CACHE_PATH'] =
      `/tmp/ogg-short-straddle-services-${process.pid}.ndjson`;
    vi.resetModules();
    const services = await import('./services.js');
    const collector = services.shortStraddleSnapshotService;
    if (collector == null || getSurfaceGrid == null) {
      throw new Error('short-straddle collector not registered');
    }
    vi.spyOn(collector, 'collect').mockRejectedValueOnce(new Error('collector boom'));

    await expect(getSurfaceGrid('BTC')).resolves.toEqual([]);

    await Promise.all([
      services.shortStraddleSnapshotStore?.dispose(),
      services.ivHistoryStore.dispose(),
      services.oiSnapshotStore.dispose(),
      services.dealerBookStore.dispose(),
      services.regimeStore.dispose(),
      services.tradeStore.dispose(),
      services.leadsStore.dispose(),
    ]);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}
