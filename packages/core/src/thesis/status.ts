import type {
  ThesisConfirmSec,
  ThesisDirection,
  ThesisStatus,
  ThesisStatusDetail,
} from '@oggregator/protocol';

import { expiryInstantMs } from '../portfolio/horizon-valuation.js';
import { THESIS_AT_RISK_FLOOR_PCT, THESIS_AT_RISK_MOVE_FRACTION } from './constants.js';

export interface ThesisCandle {
  /** Open time, ms. */
  timestamp: number;
  close: number;
}

export interface ThesisRule {
  direction: ThesisDirection;
  level: number;
  confirmSec: ThesisConfirmSec;
  createdAt: number;
  levelEffectiveAt?: number;
  horizonExpiry: string;
}

export interface ThesisStatusInput {
  /** Candles at `confirmSec` resolution; the still-open candle is ignored. */
  candles: ThesisCandle[];
  spotUsd: number | null;
  atmIv: number | null;
  nowMs: number;
}

export function isBeyondLevel(direction: ThesisDirection, level: number, price: number): boolean {
  return direction === 'bearish' ? price > level : price < level;
}

export function atRiskBandUsd(spotUsd: number, atmIv: number | null): number {
  const floor = THESIS_AT_RISK_FLOOR_PCT * spotUsd;
  if (atmIv == null || !(atmIv > 0)) return floor;
  return Math.max(floor, THESIS_AT_RISK_MOVE_FRACTION * spotUsd * atmIv * Math.sqrt(1 / 365));
}

/** A changed level applies only to future closes, within the original thesis horizon. */
export function firedCandle(rule: ThesisRule, candles: ThesisCandle[], nowMs: number): ThesisCandle | null {
  const spanMs = rule.confirmSec * 1000;
  const effectiveAt = Math.max(rule.createdAt, rule.levelEffectiveAt ?? rule.createdAt);
  const lastCloseMs = Math.min(nowMs, expiryInstantMs(rule.horizonExpiry));
  let fired: ThesisCandle | null = null;
  for (const candle of candles) {
    const closeMs = candle.timestamp + spanMs;
    if (closeMs <= effectiveAt || closeMs > lastCloseMs) continue;
    if (!isBeyondLevel(rule.direction, rule.level, candle.close)) continue;
    if (fired == null || candle.timestamp < fired.timestamp) fired = candle;
  }
  return fired;
}

export function thesisStatus(rule: ThesisRule, input: ThesisStatusInput): ThesisStatusDetail {
  const { spotUsd, nowMs } = input;
  const horizonMs = expiryInstantMs(rule.horizonExpiry);
  const fired = firedCandle(rule, input.candles, nowMs);
  const roomPct =
    spotUsd != null && spotUsd > 0
      ? (rule.direction === 'bearish' ? rule.level - spotUsd : spotUsd - rule.level) / spotUsd
      : null;
  const band = spotUsd != null && spotUsd > 0 ? atRiskBandUsd(spotUsd, input.atmIv) : null;

  let status: ThesisStatus = 'INTACT';
  if (fired != null) status = 'INVALIDATED';
  else if (nowMs >= horizonMs) status = 'EXPIRED';
  else if (roomPct != null && band != null && spotUsd != null && roomPct * spotUsd <= band) {
    status = 'AT_RISK';
  }

  return {
    status,
    spotUsd,
    roomPct,
    atRiskBandUsd: band,
    msToHorizon: Math.max(0, horizonMs - nowMs),
    firedCandleTs: fired?.timestamp ?? null,
  };
}
