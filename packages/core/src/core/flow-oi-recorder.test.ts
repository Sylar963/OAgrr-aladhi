import { describe, expect, it, vi } from 'vitest';
import { FlowOiRecorder } from './flow-oi-recorder.js';
import type { FlowOiTick } from '@oggregator/protocol';

describe('FLOW OI capture', () => {
  it('filters within a batch and advances deduplication only after a successful write', () => {
    const write = vi.fn();
    const recorder = new FlowOiRecorder(write, () => 1_000_000);
    const event = {
      venue: 'deribit' as const,
      exchangeSymbol: 'BTC-X',
      ts: 1_000_000,
      markPrice: 1,
      openInterest: { timestamp: 1_000_000, value: 100, underlying: 'BTC' },
    };
    const changed = { ...event, openInterest: { ...event.openInterest, timestamp: 1_000_001, value: 101 } };
    const batch = [event, event, changed];
    const writeBatch = vi.fn().mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    expect(() => recorder.recordBatch(batch, writeBatch)).toThrow('disk unavailable');
    recorder.recordBatch(batch, writeBatch);
    expect(writeBatch).toHaveBeenCalledTimes(2);
    expect(writeBatch.mock.calls[0]![0]).toEqual(writeBatch.mock.calls[1]![0]);
    expect(writeBatch.mock.calls[1]![0]).toHaveLength(2);
    recorder.recordBatch(batch, writeBatch);
    expect(writeBatch).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
  });

  it('captures changes and five-minute heartbeats without treating copied OI as fresh', () => {
    let now = 1000000;
    const ticks: FlowOiTick[] = [];
    const recorder = new FlowOiRecorder(
      (tick) => ticks.push(tick),
      () => now,
    );
    const event = {
      venue: 'deribit' as const,
      exchangeSymbol: 'BTC-30OCT26-83000-C',
      ts: now,
      markPrice: 0.01,
      openInterest: { timestamp: now, value: 100, underlying: 'BTC' },
    };
    recorder.record(event);
    recorder.record({ ...event, ts: now + 100 });
    now += 1000;
    recorder.record({ ...event, openInterest: { ...event.openInterest, timestamp: now } });
    expect(ticks).toHaveLength(1);
    recorder.record({
      ...event,
      openInterest: { ...event.openInterest, timestamp: now + 1, value: 100.2 },
    });
    expect(ticks).toHaveLength(2);
    now += 300001;
    recorder.record({
      ...event,
      openInterest: { ...event.openInterest, timestamp: now, value: 100.2 },
    });
    expect(ticks).toHaveLength(3);
    expect(ticks[2]?.observedAt).toBe(now);
  });
  it('rejects stale, future and invalid OI', () => {
    const ticks: FlowOiTick[] = [];
    const recorder = new FlowOiRecorder(
      (tick) => ticks.push(tick),
      () => 1000000,
    );
    for (const [timestamp, value] of [
      [0, 1],
      [2000000, 1],
      [1000000, -1],
    ])
      recorder.record({
        venue: 'deribit',
        exchangeSymbol: 'x',
        ts: 1000000,
        markPrice: 1,
        openInterest: { timestamp: timestamp!, value: value!, underlying: 'BTC' },
      });
    expect(ticks).toHaveLength(0);
  });
});
