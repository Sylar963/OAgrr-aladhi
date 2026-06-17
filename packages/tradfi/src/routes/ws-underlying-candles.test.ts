import { describe, expect, it } from 'vitest';
import { CandleStreamer } from './ws-underlying-candles.js';
import type { RawCandle } from '../tastytrade/candle-codec.js';

function bar(time: number, c: number, over: Partial<RawCandle> = {}): RawCandle {
  return { symbol: 'SPX{=5m}', flags: 0, time, o: c, h: c, l: c, c, v: 1, ...over };
}

describe('CandleStreamer', () => {
  it('flushes a mapped bar as JSON', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.onBar(bar(1781553000000, 56));
    s.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toMatchObject({ type: 'bar', ts: 1781553000000, c: 56 });
  });

  it('coalesces repeated updates to the same ts into one send with the latest values', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.onBar(bar(1781553000000, 56));
    s.onBar(bar(1781553000000, 57, { h: 57 }));
    s.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).c).toBe(57);
  });

  it('drops invalid bars (non-finite close)', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.onBar(bar(1781553000000, Number.NaN));
    s.flush();
    expect(sent).toHaveLength(0);
  });

  it('sends nothing after dispose', () => {
    const sent: string[] = [];
    const s = new CandleStreamer((d) => sent.push(d));
    s.dispose();
    s.onBar(bar(1781553000000, 56));
    s.flush();
    expect(sent).toHaveLength(0);
  });
});
