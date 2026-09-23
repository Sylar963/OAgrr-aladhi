import type { PortfolioMetrics, PositionLeg } from '@oggregator/protocol';

export type PortfolioRiskMetric = 'delta' | 'gamma' | 'vega' | 'theta' | 'vanna' | 'volga';

export interface PortfolioAssistantPositionFact {
  legId: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  size: number;
  entryPriceUsd: number;
  entryIv: number | null;
  currentMarkUsd: number | null;
  currentIv: number | null;
  currentIvIsModel: boolean;
}

export interface PortfolioRiskContributor {
  key: string;
  dimension: 'strike' | 'expiry';
  expiry: string;
  strike: number | null;
  optionRight: 'call' | 'put' | null;
  metric: PortfolioRiskMetric;
  value: number;
}

export interface PortfolioAssistantRiskFacts {
  positions: PortfolioAssistantPositionFact[];
  totals: PortfolioMetrics['totals'];
  byStrike: PortfolioMetrics['byStrike'];
  byExpiry: PortfolioMetrics['byExpiry'];
  missingMarkLegIds: string[];
  mixedUnderlyings: boolean;
  limitations: string[];
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error('portfolio assistant facts received a non-finite value');
  return value;
}

export function buildPortfolioAssistantRiskFacts(
  positions: PositionLeg[],
  metrics: PortfolioMetrics,
): PortfolioAssistantRiskFacts {
  const breakEvenByLeg = new Map(metrics.breakEven.map((row) => [row.legId, row]));
  const positionFacts = positions.map((position) => {
    const mark = breakEvenByLeg.get(position.legId);
    return {
      legId: position.legId,
      underlying: position.underlying,
      expiry: position.expiry,
      strike: finite(position.strike),
      optionRight: position.optionRight,
      size: finite(position.size),
      entryPriceUsd: finite(position.entryPriceUsd),
      entryIv: finiteOrNull(position.entryIv),
      currentMarkUsd: finiteOrNull(mark?.currentMarkUsd ?? null),
      currentIv: finiteOrNull(mark?.currentIv ?? null),
      currentIvIsModel: mark?.currentIvIsModel === true,
    };
  });
  const missingMarkLegIds = positionFacts
    .filter((position) => position.currentMarkUsd == null)
    .map((position) => position.legId);
  const limitations: string[] = [];
  if (missingMarkLegIds.length > 0) {
    limitations.push(
      `${missingMarkLegIds.length} position(s) have no current mark: ${missingMarkLegIds.join(', ')}.`,
    );
  }
  if (metrics.shockGridMeta.excludedLegIds.length > 0) {
    limitations.push(
      `${metrics.shockGridMeta.excludedLegIds.length} position(s) are excluded from shock repricing: ${metrics.shockGridMeta.excludedLegIds.join(', ')}.`,
    );
  }
  if (metrics.pnlCurve.status !== 'ok')
    limitations.push(`PnL curve status is ${metrics.pnlCurve.status}.`);
  if (metrics.accounting.persistence === 'unavailable') {
    limitations.push('Fees and venue trade history are unavailable; do not infer them as zero.');
  }
  return {
    positions: positionFacts,
    totals: metrics.totals,
    byStrike: metrics.byStrike,
    byExpiry: metrics.byExpiry,
    missingMarkLegIds,
    mixedUnderlyings: new Set(positions.map((position) => position.underlying)).size > 1,
    limitations,
  };
}

export function rankPortfolioRiskContributors(
  facts: PortfolioAssistantRiskFacts,
  metric: PortfolioRiskMetric,
): PortfolioRiskContributor[] {
  const rows: PortfolioRiskContributor[] =
    metric === 'theta'
      ? facts.byExpiry.map((row) => ({
          key: row.expiry,
          dimension: 'expiry',
          expiry: row.expiry,
          strike: null,
          optionRight: null,
          metric,
          value: finite(row.theta),
        }))
      : facts.byStrike.map((row) => ({
          key: `${row.expiry}|${row.strike}|${row.optionRight}`,
          dimension: 'strike',
          expiry: row.expiry,
          strike: finite(row.strike),
          optionRight: row.optionRight,
          metric,
          value: finite(row[metric]),
        }));
  return rows.sort(
    (left, right) =>
      Math.abs(right.value) - Math.abs(left.value) || left.key.localeCompare(right.key),
  );
}
