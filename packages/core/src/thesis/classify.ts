import type {
  PositionLeg,
  ThesisClassification,
  ThesisStructureClass,
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

export function classifyBias(
  upPnlUsd: number,
  downPnlUsd: number,
): { classification: Exclude<ThesisClassification, 'unknown'>; bias: number } {
  const scale = Math.abs(upPnlUsd) + Math.abs(downPnlUsd);
  if (Math.max(Math.abs(upPnlUsd), Math.abs(downPnlUsd)) < THESIS_MIN_PNL_USD || scale <= 0) {
    return { classification: 'neutral', bias: 0 };
  }
  const bias = (upPnlUsd - downPnlUsd) / scale;
  if (bias >= THESIS_BIAS_THRESHOLD) return { classification: 'bullish', bias };
  if (bias <= -THESIS_BIAS_THRESHOLD) return { classification: 'bearish', bias };
  return { classification: 'neutral', bias };
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
    note,
  };
}

/**
 * Direction of a book over the thesis horizon: P&L at a ±1σ move to the horizon, IV held
 * constant. Entry prices are taken as given, so callers that want the exposure from now on
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
    [-movePct, movePct],
  );
  if (scenarios.status !== 'ok') return unknown(scenarios.status.replaceAll('_', ' '));

  const down = scenarios.cells.find((cell) => cell.spotMovePct < 0);
  const up = scenarios.cells.find((cell) => cell.spotMovePct > 0);
  if (down == null || up == null) return unknown('scenario grid incomplete');

  const { classification, bias } = classifyBias(up.pnlUsd, down.pnlUsd);
  return {
    classification,
    bias,
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
