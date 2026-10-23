import type {
  PositionLeg,
  ThesisClassification,
  ThesisDirection,
  ThesisStructureClass,
  ThesisStructureShape,
} from '@oggregator/protocol';

import { buildPortfolioHorizonScenarios } from '../portfolio/pnl-curve.js';
import type { MarkContext } from '../portfolio/types.js';
import { THESIS_BIAS_THRESHOLD, THESIS_MIN_BAND_PCT, THESIS_MIN_PNL_USD } from './constants.js';

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;

export interface ThesisLegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

export interface ClassifyBookInput {
  legs: ThesisLegWithMark[];
  spotUsd: number | null;
  horizonMs: number;
  nowMs: number;
  /** ATM IV of the horizon expiry; falls back to the median leg IV. */
  atmIv: number | null;
}

export interface BiasResult {
  classification: Exclude<ThesisClassification, 'unknown'>;
  bias: number;
  shape: ThesisStructureShape | null;
  lean: ThesisDirection | null;
}

function pnlSign(pnlUsd: number): -1 | 0 | 1 {
  if (Math.abs(pnlUsd) < THESIS_MIN_PNL_USD) return 0;
  return pnlUsd > 0 ? 1 : -1;
}

/**
 * Directional when one side of the ±1σ move pays and the other costs. When both sides pay or
 * both cost, the bet is on move size. Long vol paid mostly on one side is still a bet on that
 * side, so a strong lean classifies as that direction. Short vol never does: it loses either
 * way, so a short straddle that loses less on the way up is a bet that price stays put, not a
 * bullish trade. `flatPnlUsd` (no move, same horizon) tells long vol from short vol, since a
 * short straddle can still be up at ±1σ on decay alone.
 */
export function classifyBias(upPnlUsd: number, downPnlUsd: number, flatPnlUsd: number): BiasResult {
  const scale = Math.abs(upPnlUsd) + Math.abs(downPnlUsd);
  const up = pnlSign(upPnlUsd);
  const down = pnlSign(downPnlUsd);
  if ((up === 0 && down === 0) || scale <= 0) {
    return { classification: 'neutral', bias: 0, shape: null, lean: null };
  }
  const bias = (upPnlUsd - downPnlUsd) / scale;
  if (up !== down) {
    return { classification: up > down ? 'bullish' : 'bearish', bias, shape: 'directional', lean: null };
  }
  const lean = bias >= THESIS_BIAS_THRESHOLD ? 'bullish' : bias <= -THESIS_BIAS_THRESHOLD ? 'bearish' : null;
  if ((upPnlUsd + downPnlUsd) / 2 < flatPnlUsd) {
    return { classification: 'neutral', bias, shape: 'short_vol', lean };
  }
  return { classification: lean ?? 'neutral', bias, shape: 'long_vol', lean };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function unknown(note: string): ThesisStructureClass {
  return {
    classification: 'unknown',
    bias: null,
    upPnlUsd: null,
    downPnlUsd: null,
    movePct: null,
    shape: null,
    lean: null,
    note,
  };
}

/**
 * Direction of a book over the thesis horizon: P&L at a ±1σ move (and no move) to the
 * horizon, IV held constant. Entry prices are taken as given, so callers that want the exposure from now on
 * pass legs re-based to their current mark (see `rebaseToMark`).
 */
export function classifyBook(input: ClassifyBookInput): ThesisStructureClass {
  const { legs, spotUsd, horizonMs, nowMs } = input;
  if (legs.length === 0) return unknown('no legs');
  if (spotUsd == null || !(spotUsd > 0)) return unknown('spot unavailable');

  const legIvs = legs
    .map(({ mark, leg }) => mark.iv ?? leg.entryIv)
    .filter((iv): iv is number => iv != null && iv > 0);
  const sigma = input.atmIv != null && input.atmIv > 0 ? input.atmIv : median(legIvs);
  if (sigma == null) return unknown('no implied volatility');

  const msToHorizon = Math.max(0, horizonMs - nowMs);
  const move = Math.max(THESIS_MIN_BAND_PCT, sigma * Math.sqrt(msToHorizon / YEAR_MS));
  const movePct = move * 100;

  const priced = legs.map(({ leg, mark }) => ({
    leg,
    mark: { ...mark, underlyingPriceUsd: spotUsd, forwardPriceUsd: mark.forwardPriceUsd ?? spotUsd },
  }));
  const scenarios = buildPortfolioHorizonScenarios(
    priced,
    nowMs,
    [msToHorizon / DAY_MS],
    [-movePct, 0, movePct],
  );
  if (scenarios.status !== 'ok') return unknown(scenarios.status.replaceAll('_', ' '));

  const down = scenarios.cells.find((cell) => cell.spotMovePct < 0);
  const flat = scenarios.cells.find((cell) => cell.spotMovePct === 0);
  const up = scenarios.cells.find((cell) => cell.spotMovePct > 0);
  if (down == null || flat == null || up == null) return unknown('scenario grid incomplete');

  return {
    ...classifyBias(up.pnlUsd, down.pnlUsd, flat.pnlUsd),
    upPnlUsd: up.pnlUsd,
    downPnlUsd: down.pnlUsd,
    movePct,
    note: null,
  };
}

/** Re-base held legs to their current mark so classification sees only exposure from now on. */
export function rebaseToMark(legs: ThesisLegWithMark[]): ThesisLegWithMark[] {
  return legs.map(({ leg, mark }) => ({
    leg: { ...leg, entryPriceUsd: mark.markPriceUsd ?? leg.entryPriceUsd },
    mark,
  }));
}
