import type { BreakEvenResponse, ExpiryRiskWindow, TimeAtPriceResponse } from '@oggregator/protocol';

import type { CompactChain, CompactChainRow, CompactSurfaceRow, compactGex } from './assistant-market/market-data-compaction.js';
import type { MarketReadResult } from './assistant-market/market-data-reader.js';

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365;
const EXPIRY_HOUR_UTC = 8;
const LEVELS_PER_SIDE = 3;
const PRICE_LEVEL_BAND = 0.25;
const PRICE_LEVEL_SMOOTHING_BINS = 2;
const PRICE_LEVEL_MIN_GAP = 0.02;
const OI_CLUSTERS_PER_SIDE = 3;

export type CompactGex = ReturnType<typeof compactGex>;

export interface PortfolioAssistantProfitZone {
  /** Null on the open-ended side. */
  fromSpotUsd: number | null;
  toSpotUsd: number | null;
}

export interface PortfolioAssistantExpiryOutlook {
  until: string;
  daysToExpiry: number;
  atmIv: number | null;
  atmIvSource: 'expiry' | 'interpolated' | 'nearest' | null;
  /** One standard deviation at atmIv: spot × IV × √(days/365). */
  expectedMovePct: number | null;
  expectedRangeUsd: { low: number; high: number } | null;
  breakevens: Array<{
    spotUsd: number;
    movePct: number;
    insideExpectedRange: boolean | null;
    probabilityAbove: number | null;
  }>;
  profitZones: PortfolioAssistantProfitZone[] | null;
  /** Lognormal at atmIv, forward = spot, no skew: a market-implied estimate, not a forecast. */
  profitProbability: number | null;
}

export interface PortfolioAssistantPriceLevel {
  priceUsd: number;
  distancePct: number;
  /** Hours traded through this level relative to the busiest level in the band (1 = busiest). */
  activity: number;
}

export interface PortfolioAssistantLevelInputs {
  underlying: string;
  gamma: CompactGex | null;
  timeAtPrice: Pick<TimeAtPriceResponse, 'lookbackDays' | 'levels' | 'binSize'> | null;
  breakEvens: Array<Pick<BreakEvenResponse, 'expiry' | 'lines' | 'historical'>>;
  unavailable: string[];
}

export interface PortfolioAssistantBookVsMarketFacts {
  underlying: string;
  spotUsd: number;
  expiryOutlook: PortfolioAssistantExpiryOutlook[];
  gammaLevels: {
    netGexUsdMillions: number | null;
    positive: Array<{ strike: number; gexUsdMillions: number | null; distancePct: number }>;
    negative: Array<{ strike: number; gexUsdMillions: number | null; distancePct: number }>;
  } | null;
  priceLevels: {
    lookbackDays: number;
    support: PortfolioAssistantPriceLevel[];
    resistance: PortfolioAssistantPriceLevel[];
  } | null;
  openInterestLevels: Array<{
    expiry: string;
    calls: Array<{ strike: number; openInterestContracts: number }>;
    puts: Array<{ strike: number; openInterestContracts: number }>;
  }>;
  heldLegOdds: Array<{
    expiry: string;
    strike: number;
    right: 'call' | 'put';
    breakEvenUsd: number;
    impliedProbBeyondStrike: number;
    historicalProbBeyondStrike: number | null;
    historicalWindows: number;
  }>;
  notes: string[];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function distancePct(price: number, spot: number): number {
  return round(((price - spot) / spot) * 100, 2);
}

// Abramowitz–Stegun 7.1.26; error below 1.5e-7, far finer than the inputs.
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function probabilityAbove(spot: number, strike: number, iv: number, years: number): number {
  if (strike <= 0) return 1;
  const stdev = iv * Math.sqrt(years);
  return normalCdf((Math.log(spot / strike) - (stdev * stdev) / 2) / stdev);
}

/** ATM IV for a horizon: the matching expiry, else linear in total variance between neighbours. */
export function atmIvForHorizon(
  rows: readonly Pick<CompactSurfaceRow, 'expiry' | 'daysToExpiry' | 'ivAtm'>[],
  expiry: string,
  days: number,
): { iv: number; source: 'expiry' | 'interpolated' | 'nearest' } | null {
  const usable = rows
    .filter((row): row is typeof row & { ivAtm: number } => row.ivAtm != null && row.ivAtm > 0 && row.daysToExpiry > 0)
    .sort((left, right) => left.daysToExpiry - right.daysToExpiry);
  const exact = usable.find((row) => row.expiry === expiry);
  if (exact != null) return { iv: exact.ivAtm, source: 'expiry' };
  const after = usable.findIndex((row) => row.daysToExpiry >= days);
  const upper = after === -1 ? undefined : usable[after];
  const lower = after === -1 ? usable.at(-1) : after > 0 ? usable[after - 1] : undefined;
  if (lower != null && upper != null) {
    const weight = (days - lower.daysToExpiry) / (upper.daysToExpiry - lower.daysToExpiry);
    const variance =
      lower.ivAtm ** 2 * lower.daysToExpiry + weight * (upper.ivAtm ** 2 * upper.daysToExpiry - lower.ivAtm ** 2 * lower.daysToExpiry);
    return { iv: Math.sqrt(variance / days), source: 'interpolated' };
  }
  const nearest = upper ?? lower;
  return nearest == null ? null : { iv: nearest.ivAtm, source: 'nearest' };
}

/**
 * Spot ranges where the window's P&L is positive. The sign alternates across breakevens and starts
 * from the P&L at zero spot; null when that sign is unknown or contradicts the best-profit spot.
 */
export function profitZonesOf(window: ExpiryRiskWindow): PortfolioAssistantProfitZone[] | null {
  const breakevens = [...window.breakevenSpotsUsd].sort((left, right) => left - right);
  const edges: Array<number | null> = [null, ...breakevens, null];
  const zones = edges.slice(0, -1).map((from, index) => ({ fromSpotUsd: from, toSpotUsd: edges[index + 1] ?? null }));
  let firstProfitable: boolean;
  if (window.lossAtZeroSpotUsd !== 0) firstProfitable = window.lossAtZeroSpotUsd > 0;
  else if (window.bestProfitSpotUsd != null) {
    const best = window.bestProfitSpotUsd;
    const zone = zones.findIndex((item) => (item.toSpotUsd ?? Infinity) >= best);
    firstProfitable = zone % 2 === 0;
  } else return null;
  const profitable = zones.filter((_, index) => (index % 2 === 0) === firstProfitable);
  const best = window.bestProfitSpotUsd;
  if (best != null && !profitable.some((zone) => best >= (zone.fromSpotUsd ?? 0) && best <= (zone.toSpotUsd ?? Infinity))) {
    return null;
  }
  return profitable;
}

export function buildExpiryOutlook(
  windows: readonly ExpiryRiskWindow[],
  rows: readonly Pick<CompactSurfaceRow, 'expiry' | 'daysToExpiry' | 'ivAtm'>[],
  spotUsd: number,
  nowMs: number,
): PortfolioAssistantExpiryOutlook[] {
  const outlook: PortfolioAssistantExpiryOutlook[] = [];
  for (const window of windows) {
    const expiryMs = Date.parse(`${window.until}T0${EXPIRY_HOUR_UTC}:00:00.000Z`);
    const days = (expiryMs - nowMs) / DAY_MS;
    if (!Number.isFinite(days) || days <= 0) continue;
    const years = days / DAYS_PER_YEAR;
    const iv = atmIvForHorizon(rows, window.until, days);
    const move = iv == null ? null : iv.iv * Math.sqrt(years);
    const range = move == null ? null : { low: Math.round(spotUsd * (1 - move)), high: Math.round(spotUsd * (1 + move)) };
    const zones = profitZonesOf(window);
    const above = (price: number | null) =>
      price == null ? 0 : iv == null ? null : probabilityAbove(spotUsd, price, iv.iv, years);
    let profitProbability: number | null = null;
    if (zones != null && iv != null) {
      profitProbability = zones.reduce(
        (total, zone) => total + (zone.fromSpotUsd == null ? 1 : (above(zone.fromSpotUsd) ?? 0)) - (above(zone.toSpotUsd) ?? 0),
        0,
      );
      profitProbability = round(Math.min(1, Math.max(0, profitProbability)), 3);
    }
    outlook.push({
      until: window.until,
      daysToExpiry: round(days, 2),
      atmIv: iv == null ? null : round(iv.iv, 4),
      atmIvSource: iv?.source ?? null,
      expectedMovePct: move == null ? null : round(move * 100, 2),
      expectedRangeUsd: range,
      breakevens: [...window.breakevenSpotsUsd]
        .sort((left, right) => left - right)
        .map((spot) => {
          const probability = above(spot);
          return {
            spotUsd: Math.round(spot),
            movePct: distancePct(spot, spotUsd),
            insideExpectedRange: range == null ? null : spot >= range.low && spot <= range.high,
            probabilityAbove: probability == null ? null : round(probability, 3),
          };
        }),
      profitZones: zones?.map((zone) => ({
        fromSpotUsd: zone.fromSpotUsd == null ? null : Math.round(zone.fromSpotUsd),
        toSpotUsd: zone.toSpotUsd == null ? null : Math.round(zone.toSpotUsd),
      })) ?? null,
      profitProbability,
    });
  }
  return outlook;
}

/**
 * Busiest price levels within ±25% of spot: local maxima of hours traded through each bin, smoothed
 * over neighbouring bins so one noisy bin does not become a level.
 */
export function supportAndResistance(
  levels: readonly { price: number; bars: number }[],
  binSize: number,
  spotUsd: number,
): { support: PortfolioAssistantPriceLevel[]; resistance: PortfolioAssistantPriceLevel[] } {
  const band = levels.filter(
    (level) => level.price >= spotUsd * (1 - PRICE_LEVEL_BAND) && level.price <= spotUsd * (1 + PRICE_LEVEL_BAND),
  );
  const smoothed = band.map((level, index) => {
    const window = band.slice(Math.max(0, index - PRICE_LEVEL_SMOOTHING_BINS), index + PRICE_LEVEL_SMOOTHING_BINS + 1);
    return { price: level.price + binSize / 2, bars: window.reduce((sum, item) => sum + item.bars, 0) / window.length };
  });
  const busiest = Math.max(0, ...smoothed.map((level) => level.bars));
  if (busiest === 0) return { support: [], resistance: [] };
  const peaks = smoothed.filter(
    (level, index) =>
      level.bars > 0 &&
      level.bars >= (smoothed[index - 1]?.bars ?? 0) &&
      level.bars > (smoothed[index + 1]?.bars ?? 0),
  );
  const toLevel = (level: { price: number; bars: number }): PortfolioAssistantPriceLevel => ({
    priceUsd: Math.round(level.price),
    distancePct: distancePct(level.price, spotUsd),
    activity: round(level.bars / busiest, 2),
  });
  // Neighbouring peaks of one congestion zone would otherwise fill every slot with the same level.
  const strongest = (side: typeof peaks) => {
    const picked: typeof peaks = [];
    for (const level of [...side].sort((left, right) => right.bars - left.bars)) {
      if (picked.length === LEVELS_PER_SIDE) break;
      if (picked.every((other) => Math.abs(other.price - level.price) >= spotUsd * PRICE_LEVEL_MIN_GAP)) picked.push(level);
    }
    return picked.map(toLevel);
  };
  return {
    support: strongest(peaks.filter((level) => level.price < spotUsd)).sort((left, right) => right.priceUsd - left.priceUsd),
    resistance: strongest(peaks.filter((level) => level.price > spotUsd)).sort((left, right) => left.priceUsd - right.priceUsd),
  };
}

export function openInterestClusters(
  chains: readonly { expiry: string; rows: readonly Pick<CompactChainRow, 'strike' | 'side' | 'openInterestContracts'>[] }[],
) {
  return chains.map((chain) => {
    const side = (right: 'call' | 'put') =>
      chain.rows
        .filter((row): row is typeof row & { openInterestContracts: number } => row.side === right && (row.openInterestContracts ?? 0) > 0)
        .sort((left, right) => right.openInterestContracts - left.openInterestContracts)
        .slice(0, OI_CLUSTERS_PER_SIDE)
        .map((row) => ({ strike: row.strike, openInterestContracts: row.openInterestContracts }));
    return { expiry: chain.expiry, calls: side('call'), puts: side('put') };
  });
}

export function compactLevelInputs(
  underlying: string,
  gamma: MarketReadResult<CompactGex>,
  timeAtPrice: MarketReadResult<TimeAtPriceResponse>,
  breakEvens: MarketReadResult<BreakEvenResponse>[],
  expiries: readonly string[],
): PortfolioAssistantLevelInputs {
  const unavailable: string[] = [];
  if (!gamma.ok) unavailable.push(`gammaLevels unavailable: ${gamma.error}`);
  if (!timeAtPrice.ok) unavailable.push(`priceLevels unavailable: ${timeAtPrice.error}`);
  const loaded: PortfolioAssistantLevelInputs['breakEvens'] = [];
  breakEvens.forEach((result, index) => {
    if (result.ok) loaded.push({ expiry: result.data.expiry, lines: result.data.lines, historical: result.data.historical });
    else unavailable.push(`heldLegOdds for ${expiries[index] ?? 'an expiry'} unavailable: ${result.error}`);
  });
  return {
    underlying,
    gamma: gamma.ok ? gamma.data : null,
    timeAtPrice: timeAtPrice.ok
      ? { lookbackDays: timeAtPrice.data.lookbackDays, levels: timeAtPrice.data.levels, binSize: timeAtPrice.data.binSize }
      : null,
    breakEvens: loaded,
    unavailable,
  };
}

export function buildBookVsMarketFacts(input: {
  underlying: string;
  spotUsd: number;
  nowMs: number;
  riskWindows: readonly ExpiryRiskWindow[];
  termStructure: readonly Pick<CompactSurfaceRow, 'expiry' | 'daysToExpiry' | 'ivAtm'>[];
  heldExpiryChains: readonly Pick<CompactChain, 'expiry' | 'rows'>[];
  heldLegs: readonly { expiry: string; strike: number; optionRight: 'call' | 'put' }[];
  levels: PortfolioAssistantLevelInputs | null;
}): PortfolioAssistantBookVsMarketFacts {
  const { spotUsd, levels } = input;
  const gamma = levels?.gamma ?? null;
  const gexRow = (row: { strike: number; gexUsdMillions: number | null }) => ({
    strike: row.strike,
    gexUsdMillions: row.gexUsdMillions,
    distancePct: distancePct(row.strike, spotUsd),
  });
  const heldKeys = new Set(input.heldLegs.map((leg) => `${leg.expiry}:${leg.strike}:${leg.optionRight}`));
  const heldLegOdds = (levels?.breakEvens ?? []).flatMap((response) =>
    response.lines
      .filter((line) => heldKeys.has(`${response.expiry}:${line.strike}:${line.right}`))
      .map((line) => ({
        expiry: response.expiry,
        strike: line.strike,
        right: line.right,
        breakEvenUsd: Math.round(line.breakEven),
        impliedProbBeyondStrike: round(line.impliedProb, 3),
        historicalProbBeyondStrike: line.historicalProb == null ? null : round(line.historicalProb, 3),
        historicalWindows: response.historical.windows,
      })),
  );
  return {
    underlying: input.underlying,
    spotUsd: round(spotUsd, 2),
    expiryOutlook: buildExpiryOutlook(input.riskWindows, input.termStructure, spotUsd, input.nowMs),
    gammaLevels:
      gamma == null
        ? null
        : {
            netGexUsdMillions: gamma.netGexUsdMillions,
            positive: gamma.largestPositiveStrikes.slice(0, LEVELS_PER_SIDE).map(gexRow),
            negative: gamma.largestNegativeStrikes.slice(0, LEVELS_PER_SIDE).map(gexRow),
          },
    priceLevels:
      levels?.timeAtPrice == null
        ? null
        : {
            lookbackDays: levels.timeAtPrice.lookbackDays,
            ...supportAndResistance(levels.timeAtPrice.levels, levels.timeAtPrice.binSize, spotUsd),
          },
    openInterestLevels: openInterestClusters(input.heldExpiryChains),
    heldLegOdds,
    notes: [
      'expiryOutlook compares each risk window (riskBudgetFacts.riskWindows) with the move the options market prices to that date: expectedRangeUsd is ±1 standard deviation at atmIv (about 68% under a lognormal), probabilityAbove and profitProbability are lognormal at atmIv with forward = spot and no skew. Market-implied estimates, not forecasts.',
      'gammaLevels: largest dealer-gamma strikes across expiries (positive and negative GEX); priceLevels: busiest prices by hours traded through them; openInterestLevels: largest open interest per held expiry. All are descriptive levels, not proven support or resistance.',
      'heldLegOdds: Deribit break-even per held strike; impliedProbBeyondStrike is N(d2) (calls) or N(-d2) (puts), historicalProbBeyondStrike is the share of past same-length moves, trend removed, that finished beyond the strike, a historical frequency, not a forecast.',
      ...(levels?.unavailable ?? []),
    ],
  };
}
