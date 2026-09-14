import type { VegaByStrikeRow } from '@oggregator/protocol';

export type StrikeRiskMode = 'delta' | 'vega' | 'gamma' | 'vanna' | 'volga';

export interface StrikeRiskBucket {
  strike: number;
  rawValue: number;
  scenarioValue: number;
  contracts: number;
}

export function translateStrikeRisk(
  mode: StrikeRiskMode,
  rawValue: number,
  spotUsd: number | null,
): number {
  switch (mode) {
    case 'delta':
      return spotUsd == null ? rawValue : rawValue * spotUsd * 0.01;
    case 'vega':
      return rawValue;
    case 'gamma': {
      if (spotUsd == null) return rawValue;
      const fivePctMoveUsd = spotUsd * 0.05;
      return 0.5 * rawValue * fivePctMoveUsd * fivePctMoveUsd;
    }
    case 'vanna':
      return rawValue * 5;
    case 'volga':
      return 0.5 * rawValue * 5 * 5;
  }
}

export function buildStrikeRiskBuckets(
  rows: VegaByStrikeRow[],
  expiry: string | null,
  mode: StrikeRiskMode,
  spotUsd: number | null,
): StrikeRiskBucket[] {
  const buckets = new Map<number, { rawValue: number; contracts: number }>();

  for (const row of rows) {
    if (expiry != null && row.expiry !== expiry) continue;
    const prior = buckets.get(row.strike) ?? { rawValue: 0, contracts: 0 };
    prior.rawValue += row[mode];
    prior.contracts += row.contracts;
    buckets.set(row.strike, prior);
  }

  return [...buckets.entries()]
    .map(([strike, bucket]) => ({
      strike,
      rawValue: bucket.rawValue,
      scenarioValue: translateStrikeRisk(mode, bucket.rawValue, spotUsd),
      contracts: bucket.contracts,
    }))
    .filter((bucket) => Number.isFinite(bucket.strike) && Number.isFinite(bucket.scenarioValue))
    .sort((left, right) => left.strike - right.strike);
}
