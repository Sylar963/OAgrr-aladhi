import type { PersistedBreakEvenSnapshot } from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';
import {
  type BreakEvenChainInputs,
  BreakEvenService,
  chartStepMs,
  lookbackDays,
  nextSampleDelay,
  trimForRecording,
} from './break-even-service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_000 * DAY + 30 * 60_000;

function chain(expiryTs = NOW + 10 * DAY, forward = 64_000): BreakEvenChainInputs {
  const strikes = Array.from({ length: 41 }, (_, i) => 44_000 + i * 1_000);
  return {
    expiry: '1972-10-07',
    expiryTs,
    spot: forward - 100,
    forward,
    strikes,
    markIvs: strikes.map((strike) => 0.4 + Math.abs(Math.log(strike / forward)) * 0.5),
  };
}

function service(overrides: Partial<ConstructorParameters<typeof BreakEvenService>[0]> = {}) {
  const writes: PersistedBreakEvenSnapshot[][] = [];
  const svc = new BreakEvenService({
    underlyings: ['BTC'],
    store: {
      writeMany: async (rows) => {
        writes.push(rows);
      },
      loadActive: async () => [],
    },
    listChains: async () => [chain()],
    getChain: async () => chain(),
    getDailyCloses: async () =>
      Array.from({ length: 400 }, (_, i) => 60_000 * Math.exp(0.03 * Math.sin(i * 1.7))),
    getSpotHistory: async () => [
      { ts: NOW - 2 * HOUR, close: 63_800 },
      { ts: NOW - HOUR, close: 63_900 },
    ],
    now: () => NOW,
    log: { debug: () => {}, warn: () => {} },
    ...overrides,
  });
  return { svc, writes };
}

describe('break-even helpers', () => {
  it('samples just after each hour boundary', () => {
    expect(nextSampleDelay(10 * HOUR + 5_000)).toBe(HOUR);
    expect(nextSampleDelay(10 * HOUR)).toBe(5_000);
  });

  it('coarsens the chart grid and clamps lookback by DTE', () => {
    expect(chartStepMs(10)).toBe(HOUR);
    expect(chartStepMs(90)).toBe(4 * HOUR);
    expect(chartStepMs(400)).toBe(DAY);
    expect(lookbackDays(2)).toBe(7);
    expect(lookbackDays(18.2)).toBe(19);
    expect(lookbackDays(90)).toBe(30);
  });

  it('drops strikes outside the recordable delta band and rounds IV', () => {
    const row = trimForRecording(NOW, 'btc', {
      ...chain(),
      strikes: [20_000, 64_000, 200_000],
      markIvs: [0.4, 0.412345, 0.4],
    })!;
    expect(row.underlying).toBe('BTC');
    expect(row.strikes).toEqual([64_000]);
    expect(row.markIvs).toEqual([0.4123]);
  });
});

describe('BreakEvenService', () => {
  it('records one smile per expiry and slot, skipping long-dated expiries', async () => {
    const listChains = vi.fn(async () => [
      chain(),
      { ...chain(NOW + 200 * DAY), expiry: '1973-04-25' },
    ]);
    const { svc, writes } = service({ listChains });
    await svc.sampleAll();
    await svc.sampleAll();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.map((row) => row.expiry)).toEqual(['1972-10-07']);
    expect(writes[0]![0]!.slotTs).toEqual(new Date(1_000 * DAY));
  });

  it('answers with OTM lines, recorded history, projections and both probabilities', async () => {
    const { svc } = service();
    await svc.sampleAll();
    const response = (await svc.query('btc', '1972-10-07'))!;

    expect(response.underlying).toBe('BTC');
    expect(response.recordedSince).toBe(1_000 * DAY);
    expect(response.spotHistory.at(-1)).toEqual({ ts: NOW, value: 63_900 });
    expect(response.lines.length).toBeGreaterThan(4);
    for (const line of response.lines) {
      const otm = line.right === 'call' ? line.strike >= 64_000 : line.strike < 64_000;
      expect(otm).toBe(true);
      expect(Math.abs(line.delta)).toBeLessThanOrEqual(0.55);
      expect(line.impliedProb).toBeGreaterThan(0);
      expect(line.historicalProb).not.toBeNull();
      expect(line.history).toHaveLength(1);
      expect(line.projection[0]!.ts).toBe(NOW);
      expect(line.projection.at(-1)).toEqual({ ts: NOW + 10 * DAY, value: line.strike });
      if (line.right === 'call') expect(line.breakEven).toBeGreaterThan(line.strike);
      else expect(line.breakEven).toBeLessThan(line.strike);
    }
    expect(response.historical.horizonDays).toBe(10);
    expect(response.historical.windows).toBe(390);
  });

  it('returns null when the venue has no smile or the expiry has passed', async () => {
    expect(await service({ getChain: async () => null }).svc.query('BTC', 'x')).toBeNull();
    const expired = service({ getChain: async () => chain(NOW - HOUR) });
    expect(await expired.svc.query('BTC', '1972-10-07')).toBeNull();
  });
});
