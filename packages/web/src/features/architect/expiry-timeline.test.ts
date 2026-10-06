import { describe, expect, it } from 'vitest';
import { buildExpiryMarks, findBreakevenCrossing, fmtTimeLeft } from './expiry-timeline';
import type { SpotCandle } from './queries';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-06T08:00:00Z');

function path(closes: number[]): SpotCandle[] {
  let open = closes[0]!;
  return closes.map((close, i) => {
    const c = { timestamp: NOW + i * 24 * HOUR, open, high: close, low: close, close };
    open = close;
    return c;
  });
}

describe('buildExpiryMarks', () => {
  it('dedupes, sorts, drops past expiries and flags the nearest', () => {
    const marks = buildExpiryMarks(
      ['2026-10-30', '2026-10-16', '2026-10-16', '2026-10-01'],
      'crypto',
      NOW,
    );
    expect(marks.map((m) => m.label)).toEqual(['EXP 16 OCT · 10d', 'EXP 30 OCT · 24d']);
    expect(marks.map((m) => m.nearest)).toEqual([true, false]);
  });

  it('anchors tradfi expiries at 21:00Z', () => {
    const [mark] = buildExpiryMarks(['2026-10-06'], 'tradfi', NOW);
    expect(mark!.expiryMs).toBe(Date.parse('2026-10-06T21:00:00Z'));
    expect(mark!.label).toBe('EXP 6 OCT · 13h');
  });
});

describe('fmtTimeLeft', () => {
  it('uses hours under a day and tenths of a day above', () => {
    expect(fmtTimeLeft(5 * HOUR)).toBe('5h');
    expect(fmtTimeLeft(36 * HOUR)).toBe('1.5d');
    expect(fmtTimeLeft(-1)).toBe('0h');
  });
});

describe('findBreakevenCrossing', () => {
  const expiryMs = NOW + 10 * 24 * HOUR;

  it('returns the first bar that closes across a break-even', () => {
    const crossing = findBreakevenCrossing(path([100, 104, 108, 112, 109]), [107], expiryMs);
    expect(crossing!.timestamp).toBe(NOW + 2 * 24 * HOUR);
    expect(crossing!.label).toBe('BE 8 OCT · 8d left');
  });

  it('detects downward crossings', () => {
    const crossing = findBreakevenCrossing(path([100, 97, 93]), [95, 120], expiryMs);
    expect(crossing!.timestamp).toBe(NOW + 2 * 24 * HOUR);
  });

  it('returns null when the path never crosses', () => {
    expect(findBreakevenCrossing(path([100, 101, 102]), [110], expiryMs)).toBeNull();
    expect(findBreakevenCrossing(path([100, 101]), [], expiryMs)).toBeNull();
  });
});
