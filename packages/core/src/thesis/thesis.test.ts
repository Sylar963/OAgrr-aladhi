import type { PositionLeg, ThesisMarketContext } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import type { MarkContext } from '../portfolio/types.js';
import {
  classifyBias,
  classifyBook,
  contextDiff,
  gateDecision,
  rebaseToMark,
  thesisStatus,
  type ThesisCandle,
  type ThesisLegWithMark,
  type ThesisRule,
} from './index.js';

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(iso);

// Deribit BTC-PERPETUAL daily candles (open time, close), fetched 2026-10-19 from /api/spot-candles.
const BTC_DAILY_2026_10: Array<[string, number, number]> = [
  ['2026-10-06', 86706.5, 84121],
  ['2026-10-07', 84160.5, 82968],
  ['2026-10-08', 83145, 82608],
  ['2026-10-09', 83479, 82764],
  ['2026-10-10', 83169, 82956.5],
  ['2026-10-11', 84280, 83937.5],
  ['2026-10-12', 83989, 83792.5],
  ['2026-10-13', 84104.5, 83515],
  ['2026-10-14', 84092.5, 81449.5],
  ['2026-10-15', 82591.5, 82219.5],
  ['2026-10-16', 82859.5, 81628],
  ['2026-10-17', 81983.5, 81605],
  ['2026-10-18', 83200, 82658.5],
  ['2026-10-19', 83042, 81950],
];
const dailyCandles: ThesisCandle[] = BTC_DAILY_2026_10.map(([day, , close]) => ({
  timestamp: utc(`${day}T00:00:00Z`),
  close,
}));

const caseThesis: ThesisRule = {
  direction: 'bearish',
  level: 85_105,
  confirmSec: 86400,
  createdAt: utc('2026-10-06T06:00:00Z'),
  horizonExpiry: '2026-10-23',
};

function mark(spot: number, iv: number | null, markPriceUsd: number | null = null): MarkContext {
  return {
    underlyingPriceUsd: spot,
    forwardPriceUsd: spot,
    markPriceUsd,
    iv,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    yearsToExpiry: null,
  };
}

function leg(
  strike: number,
  optionRight: 'call' | 'put',
  size: number,
  entryPriceUsd: number,
  iv = 0.45,
): PositionLeg {
  return {
    legId: `${strike}-${optionRight}-${size}`,
    underlying: 'BTC',
    expiry: '2026-10-23',
    strike,
    optionRight,
    size,
    entryPriceUsd,
    entryIv: iv,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: null,
    source: 'manual',
  };
}

const withMark = (l: PositionLeg, spot: number, markPriceUsd: number | null = null): ThesisLegWithMark => ({
  leg: l,
  mark: mark(spot, l.entryIv ?? null, markPriceUsd),
});

describe('thesis status', () => {
  it('replays the 2026-10-06 BTC short: never invalidated through 2026-10-19', () => {
    for (let day = 7; day <= 19; day += 1) {
      const nowMs = utc(`2026-10-${String(day).padStart(2, '0')}T12:00:00Z`);
      const status = thesisStatus(caseThesis, {
        candles: dailyCandles,
        spotUsd: 82_000,
        atmIv: 0.42,
        nowMs,
      });
      expect(status.status).not.toBe('INVALIDATED');
    }
  });

  it('treats a wick above the level with a close below as intact', () => {
    // 2026-10-06 traded to 86,706.5 but closed at 84,121.
    const status = thesisStatus(caseThesis, {
      candles: dailyCandles.slice(0, 1),
      spotUsd: 84_121,
      atmIv: 0.42,
      nowMs: utc('2026-10-07T01:00:00Z'),
    });
    expect(status.firedCandleTs).toBeNull();
    expect(status.status).toBe('INTACT');
  });

  it('invalidates on a close beyond the level and ignores the open candle', () => {
    const candles = [...dailyCandles, { timestamp: utc('2026-10-20T00:00:00Z'), close: 85_400 }];
    const before = thesisStatus(caseThesis, {
      candles,
      spotUsd: 85_400,
      atmIv: 0.42,
      nowMs: utc('2026-10-20T20:00:00Z'),
    });
    expect(before.status).toBe('AT_RISK');
    const after = thesisStatus(caseThesis, {
      candles,
      spotUsd: 85_400,
      atmIv: 0.42,
      nowMs: utc('2026-10-21T00:00:01Z'),
    });
    expect(after.status).toBe('INVALIDATED');
    expect(after.firedCandleTs).toBe(utc('2026-10-20T00:00:00Z'));
  });

  it('ignores closes from before the thesis was written', () => {
    const status = thesisStatus(
      { ...caseThesis, createdAt: utc('2026-10-08T00:00:00Z'), level: 82_800 },
      { candles: dailyCandles, spotUsd: 82_000, atmIv: 0.42, nowMs: utc('2026-10-10T12:00:00Z') },
    );
    expect(status.status).not.toBe('INVALIDATED');
  });

  it('expires at 08:00 UTC on the horizon expiry', () => {
    const status = thesisStatus(caseThesis, {
      candles: dailyCandles,
      spotUsd: 82_000,
      atmIv: 0.42,
      nowMs: utc('2026-10-23T08:00:00Z'),
    });
    expect(status.status).toBe('EXPIRED');
    expect(status.msToHorizon).toBe(0);
  });

  it('reports room to the level on the right side for each direction', () => {
    const bearish = thesisStatus(caseThesis, {
      candles: [],
      spotUsd: 81_000,
      atmIv: 0.42,
      nowMs: utc('2026-10-19T12:00:00Z'),
    });
    expect(bearish.status).toBe('INTACT');
    expect(bearish.roomPct).toBeCloseTo((85_105 - 81_000) / 81_000, 8);

    const bullish = thesisStatus(
      { ...caseThesis, direction: 'bullish', level: 80_000 },
      { candles: dailyCandles, spotUsd: 81_000, atmIv: 0.42, nowMs: utc('2026-10-19T12:00:00Z') },
    );
    // 2026-10-14 closed at 81,449.5, above 80,000, so a bullish rule at 80k never fired.
    expect(bullish.firedCandleTs).toBeNull();
    expect(bullish.roomPct).toBeCloseTo(1_000 / 81_000, 8);
  });
});

describe('classifyBias', () => {
  it('classifies the case legends', () => {
    expect(classifyBias(-18.05, 43.01).classification).toBe('bearish');
    expect(classifyBias(221, -164).classification).toBe('bullish');
  });

  it('calls a long straddle with similar wings neutral', () => {
    const result = classifyBias(100, 80);
    expect(result.classification).toBe('neutral');
    expect(result.bias).toBeCloseTo(20 / 180, 8);
  });

  it('calls dust-sized books neutral', () => {
    expect(classifyBias(0.4, -0.3).classification).toBe('neutral');
  });
});

describe('classifyBook', () => {
  const nowMs = utc('2026-10-17T12:00:00Z');
  const horizonMs = utc('2026-10-23T08:00:00Z');
  const spot = 83_000;

  it('classifies a call spread as bullish and a put as bearish', () => {
    const callSpread = [withMark(leg(83_000, 'call', 1, 1_500), spot), withMark(leg(86_000, 'call', -1, 500), spot)];
    expect(classifyBook({ legs: callSpread, spotUsd: spot, horizonMs, nowMs, atmIv: 0.42 }).classification).toBe(
      'bullish',
    );
    const longPut = [withMark(leg(82_000, 'put', 1, 1_200), spot)];
    const result = classifyBook({ legs: longPut, spotUsd: spot, horizonMs, nowMs, atmIv: 0.42 });
    expect(result.classification).toBe('bearish');
    expect(result.movePct).toBeCloseTo(0.42 * Math.sqrt((horizonMs - nowMs) / (365 * DAY_MS)) * 100, 6);
  });

  it('uses the minimum band when the horizon has passed', () => {
    const result = classifyBook({
      legs: [withMark(leg(82_000, 'put', 1, 1_200), spot)],
      spotUsd: spot,
      horizonMs: nowMs - 1,
      nowMs,
      atmIv: 0.42,
    });
    expect(result.movePct).toBeCloseTo(1.5, 8);
  });

  it('reports unknown without IV or spot', () => {
    const noIv = withMark({ ...leg(82_000, 'put', 1, 1_200), entryIv: null }, spot);
    expect(classifyBook({ legs: [noIv], spotUsd: spot, horizonMs, nowMs, atmIv: null }).classification).toBe(
      'unknown',
    );
    expect(
      classifyBook({ legs: [withMark(leg(82_000, 'put', 1, 1_200), spot)], spotUsd: null, horizonMs, nowMs, atmIv: 0.4 })
        .classification,
    ).toBe('unknown');
  });

  it('keeps a held bearish book bearish after a small bullish hedge', () => {
    const held = rebaseToMark([withMark(leg(83_000, 'put', 2, 900), spot, 1_400)]);
    const hedge = [withMark(leg(85_000, 'call', 0.5, 700), spot)];
    const combined = classifyBook({ legs: [...held, ...hedge], spotUsd: spot, horizonMs, nowMs, atmIv: 0.42 });
    expect(combined.classification).toBe('bearish');
  });

  it('turns a held bearish book bullish when the new structure outweighs it', () => {
    const held = rebaseToMark([withMark(leg(83_000, 'put', 1, 900), spot, 1_400)]);
    const flip = [withMark(leg(83_000, 'call', 3, 1_500), spot)];
    const combined = classifyBook({ legs: [...held, ...flip], spotUsd: spot, horizonMs, nowMs, atmIv: 0.42 });
    expect(combined.classification).toBe('bullish');
  });

  it('re-bases held legs to the current mark', () => {
    const [rebased] = rebaseToMark([withMark(leg(83_000, 'put', 1, 900), spot, 1_400)]);
    expect(rebased?.leg.entryPriceUsd).toBe(1_400);
    const [kept] = rebaseToMark([withMark(leg(83_000, 'put', 1, 900), spot, null)]);
    expect(kept?.leg.entryPriceUsd).toBe(900);
  });
});

describe('gateDecision', () => {
  it('gates the 2026-10-17 flip against the intact short', () => {
    expect(
      gateDecision({ thesisDirection: 'bearish', status: 'INTACT', reversalDirection: null, target: 'bullish' }),
    ).toEqual({ decision: 'gate', reason: 'opposite' });
  });

  it('passes same direction, neutral, and fired or expired theses', () => {
    const base = { thesisDirection: 'bearish' as const, reversalDirection: null };
    expect(gateDecision({ ...base, status: 'AT_RISK', target: 'bearish' }).decision).toBe('pass');
    expect(gateDecision({ ...base, status: 'INTACT', target: 'neutral' }).decision).toBe('pass');
    expect(gateDecision({ ...base, status: 'INVALIDATED', target: 'bullish' })).toEqual({
      decision: 'pass',
      reason: 'rule_fired',
    });
    expect(gateDecision({ ...base, status: 'EXPIRED', target: 'bullish' }).reason).toBe('expired');
  });

  it('never passes an unknown classification', () => {
    expect(
      gateDecision({ thesisDirection: 'bearish', status: 'INTACT', reversalDirection: null, target: 'unknown' })
        .decision,
    ).toBe('unknown');
  });

  it('gates an opposite structure during the reversal cooldown', () => {
    expect(
      gateDecision({ thesisDirection: null, status: null, reversalDirection: 'bearish', target: 'bullish' }),
    ).toEqual({ decision: 'gate', reason: 'reversal_cooldown' });
    expect(
      gateDecision({ thesisDirection: null, status: null, reversalDirection: 'bearish', target: 'bearish' }).decision,
    ).toBe('pass');
    expect(
      gateDecision({ thesisDirection: null, status: null, reversalDirection: null, target: 'bullish' }),
    ).toEqual({ decision: 'pass', reason: 'no_thesis' });
  });
});

describe('contextDiff', () => {
  const then: ThesisMarketContext = {
    capturedAt: 0,
    spotUsd: 84_500,
    dvol: 0.44,
    atmIv: 0.41,
    skew25d: -0.02,
    netGexUsdMillions: 12,
  };

  it('reports nothing material when the market barely moved', () => {
    const diff = contextDiff(
      then,
      { ...then, spotUsd: 83_050, dvol: 0.46, atmIv: 0.43, skew25d: -0.01, netGexUsdMillions: 8 },
      'INTACT',
    );
    expect(diff.materialCount).toBe(0);
    expect(diff.comparedCount).toBe(5);
  });

  it('flags threshold moves and sign flips', () => {
    const diff = contextDiff(
      then,
      { ...then, dvol: 0.5, atmIv: 0.47, skew25d: 0.01, netGexUsdMillions: -3 },
      'AT_RISK',
    );
    expect(diff.rows.filter((row) => row.material).map((row) => row.key)).toEqual([
      'spot',
      'dvol',
      'atmIv',
      'skew25d',
      'netGex',
    ]);
  });

  it('does not count rows with a missing side', () => {
    const diff = contextDiff({ ...then, netGexUsdMillions: null }, then, 'INTACT');
    expect(diff.comparedCount).toBe(4);
    expect(diff.rows.find((row) => row.key === 'netGex')?.material).toBeNull();
  });
});
