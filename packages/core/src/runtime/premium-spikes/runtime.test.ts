import { describe, expect, it, vi } from 'vitest';
import type { PremiumSpikeResponse } from '@oggregator/protocol';
import { chain, TEST_NOW, TEST_EXPIRY, TEST_EXPIRY_TS } from './fixtures.js';
import { PremiumSpikeRuntime } from './runtime.js';

const query = { underlying: 'BTC', venue: 'deribit' } as const;
function setup(initial = TEST_NOW) {
  let now = initial;
  let current = chain(now);
  const source = {
    expiries: vi.fn(async () => [{ expiry: TEST_EXPIRY, expiryTs: TEST_EXPIRY_TS }]),
    chains: vi.fn(async () => [current]),
  };
  const runtime = new PremiumSpikeRuntime({ source, now: () => now });
  const state = runtime.watch(query);
  return {
    runtime,
    state,
    source,
    set: (bid: number, ask: number) => {
      now += 1000;
      current = chain(now, bid, ask);
    },
    time: (value: number) => {
      now = value;
      current = chain(now);
    },
  };
}

describe('premium spike runtime', () => {
  it('seeds without alerts, requires simultaneous new independent highs, and deduplicates unchanged quotes', async () => {
    const { runtime, state, set } = setup();
    await runtime.scan();
    expect(state.alertCount).toBe(0);
    set(0.61, 0.63);
    await runtime.scan();
    expect(state.alertCount).toBe(4);
    expect(state.alerts.every((a) => a.side === 'put')).toBe(true);
    set(0.62, 0.63);
    await runtime.scan();
    set(0.61, 0.64);
    await runtime.scan();
    expect(state.alertCount).toBe(4);
    set(0.63, 0.65);
    await runtime.scan();
    expect(state.alertCount).toBe(8);
    expect(state.alerts[0]!.previousHigh.bid).toBeCloseTo(0.1);
    expect(state.alerts[0]!.previousHigh.ask).toBeCloseTo(0.14);
    await runtime.scan();
    expect(state.alertCount).toBe(8);
    set(0.4, 0.42);
    await runtime.scan();
    expect(state.alerts[0]!.side).toBe('call');
    await runtime.dispose();
  });
  it('keeps expiries fixed within a session and reseeds on Pacific midnight', async () => {
    const test = setup(Date.parse('2026-11-20T07:59:50Z'));
    await test.runtime.scan();
    test.set(0.65, 0.67);
    await test.runtime.scan();
    expect(test.state.alertCount).toBe(4);
    expect(test.source.expiries).toHaveBeenCalledTimes(1);
    test.time(Date.parse('2026-11-20T08:00:00Z'));
    expect(test.runtime.watch(query).alertCount).toBe(0);
    expect(test.state.tenors[0]!.putHigh).toBeNull();
    await test.runtime.scan();
    expect(test.state.alertCount).toBe(0);
    expect(test.source.expiries).toHaveBeenCalledTimes(2);
    await test.runtime.dispose();
  });
  it('suppresses stale quotes and source failures without losing highs', async () => {
    const test = setup();
    await test.runtime.scan();
    const high = { ...test.state.tenors[0]!.putHigh! };
    test.source.chains.mockResolvedValue([chain(TEST_NOW - 120_000, 0.9, 0.95)]);
    await test.runtime.scan();
    expect(test.state.tenors[0]!.sample).toBeNull();
    expect(test.state.tenors[0]!.putHigh).toEqual(high);
    expect(test.state.alertCount).toBe(0);
    test.source.chains.mockRejectedValue(new Error('offline'));
    await test.runtime.scan();
    expect(test.state.error).toBe('offline');
    expect(test.state.tenors[0]!.putHigh).toEqual(high);
    await test.runtime.dispose();
  });
  it('restores same-day baselines and alert IDs across restarts', async () => {
    const test = setup();
    await test.runtime.scan();
    test.set(0.65, 0.67);
    await test.runtime.scan();
    const saved = structuredClone(test.state);
    await test.runtime.dispose();
    let written: PremiumSpikeResponse[] = [];
    const runtime = new PremiumSpikeRuntime({
      source: test.source,
      now: () => TEST_NOW + 2000,
      history: {
        load: async () => [saved],
        save: async (states) => {
          written = structuredClone(states);
        },
      },
    });
    await runtime.start();
    await runtime.scan();
    expect(runtime.watch(query).alertCount).toBe(4);
    expect(written[0]!.alerts[0]!.id).toBe(saved.alerts[0]!.id);
    expect(written[0]!.tenors[0]!.putHigh).toEqual(saved.tenors[0]!.putHigh);
    await runtime.dispose();
  });
  it('discards a request spanning midnight even if a reader already rolled the state', async () => {
    const test = setup(Date.parse('2026-11-20T07:59:50Z'));
    await test.runtime.scan();
    let resolve!: (value: ReturnType<typeof chain>[]) => void;
    test.source.chains.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = test.runtime.scan();
    test.time(Date.parse('2026-11-20T08:00:01Z'));
    test.runtime.watch(query);
    resolve([chain(Date.parse('2026-11-20T08:00:01Z'), 0.95, 1)]);
    await pending;
    expect(test.state.tenors[0]!.expiry).toBeNull();
    expect(test.state.tenors[0]!.putHigh).toBeNull();
    expect(test.state.alertCount).toBe(0);
    await test.runtime.dispose();
  });
});
