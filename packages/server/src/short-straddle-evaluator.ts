import type { PersistedShortStraddleSnapshot, ShortStraddleHorizonHours } from '@oggregator/db';
import type {
  ShortStraddleEvaluationResponse,
  ShortStraddleEvaluationSegment,
} from '@oggregator/protocol';

const EVALUATED_HORIZONS = [1, 6, 24, 72] as const;
const MINIMUM_MARK_COVERAGE = 0.8;

interface ShortStraddleEvaluationOptions {
  underlying: 'BTC' | 'ETH';
  windowDays: number;
  minimumSamples: number;
  asOfMs: number;
}

interface CompletedSample {
  venue: string;
  underlying: 'BTC' | 'ETH';
  horizonHours: Exclude<ShortStraddleHorizonHours, 0>;
  cohortAt: Date;
  pnlUsdPerUnit: number;
  pnlPctOfGrossCredit: number;
  commonTopOfBookQuantity: number;
}

export function evaluateShortStraddleSnapshots(
  observations: PersistedShortStraddleSnapshot[],
  options: ShortStraddleEvaluationOptions,
): ShortStraddleEvaluationResponse {
  const entries = new Map<string, PersistedShortStraddleSnapshot>();
  for (const observation of observations) {
    if (
      observation.underlying.toUpperCase() === options.underlying &&
      observation.horizonHours === 0
    ) {
      entries.set(cohortKey(observation), observation);
    }
  }

  const eligibleBySegment = new Map<string, number>();
  for (const entry of entries.values()) {
    for (const horizonHours of EVALUATED_HORIZONS) {
      if (entry.cohortSlotTs.getTime() + horizonHours * 3_600_000 > options.asOfMs) continue;
      const key = segmentKey(entry.venue, horizonHours);
      eligibleBySegment.set(key, (eligibleBySegment.get(key) ?? 0) + 1);
    }
  }

  const samples = observations.flatMap((mark): CompletedSample[] => {
    if (mark.horizonHours === 0) return [];
    const entry = entries.get(cohortKey(mark));
    if (
      mark.underlying.toUpperCase() !== options.underlying ||
      entry == null ||
      entry.expiry !== mark.expiry ||
      entry.strike !== mark.strike ||
      !isEvaluatedHorizon(mark.horizonHours) ||
      mark.sampleSlotTs.getTime() !==
        entry.cohortSlotTs.getTime() + mark.horizonHours * 3_600_000
    ) {
      return [];
    }
    const grossCredit = entry.callBidUsd + entry.putBidUsd;
    if (!(grossCredit > 0)) return [];
    const entryFees = entry.callTakerFeeUsd + entry.putTakerFeeUsd;
    const exitDebit = mark.callAskUsd + mark.putAskUsd;
    const exitFees = mark.callAskTakerFeeUsd + mark.putAskTakerFeeUsd;
    const pnlUsdPerUnit = grossCredit - entryFees - exitDebit - exitFees;
    return [{
      venue: mark.venue,
      underlying: options.underlying,
      horizonHours: mark.horizonHours,
      cohortAt: entry.cohortSlotTs,
      pnlUsdPerUnit,
      pnlPctOfGrossCredit: pnlUsdPerUnit / grossCredit,
      commonTopOfBookQuantity: Math.min(
        entry.callBidSize,
        entry.putBidSize,
        mark.callAskSize,
        mark.putAskSize,
      ),
    }];
  });

  const grouped = new Map<string, CompletedSample[]>();
  for (const sample of samples) {
    const key = segmentKey(sample.venue, sample.horizonHours);
    const segment = grouped.get(key) ?? [];
    segment.push(sample);
    grouped.set(key, segment);
  }
  const segments = [...grouped.values()]
    .map((segment) =>
      summarizeSegment(
        segment,
        eligibleBySegment.get(segmentKey(segment[0]!.venue, segment[0]!.horizonHours)) ?? 0,
        options.minimumSamples,
      ),
    )
    .sort((a, b) => a.horizonHours - b.horizonHours || a.venue.localeCompare(b.venue));
  const latest = observations.reduce<Date | null>(
    (current, observation) =>
      current == null || observation.capturedAt > current ? observation.capturedAt : current,
    null,
  );
  const hasSufficientSegment = segments.some((segment) => segment.status === 'evidence_available');
  const eligibleSampleCount = sum([...eligibleBySegment.values()]);
  const missingMarkCount = Math.max(0, eligibleSampleCount - samples.length);

  return {
    underlying: options.underlying,
    windowDays: options.windowDays,
    minimumSamples: options.minimumSamples,
    status:
      eligibleSampleCount === 0
        ? 'collecting'
        : hasSufficientSegment
          ? 'evidence_available'
          : 'insufficient_data',
    cohortCount: entries.size,
    eligibleSampleCount,
    completedSampleCount: samples.length,
    missingMarkCount,
    markCoverageRate: eligibleSampleCount === 0 ? null : samples.length / eligibleSampleCount,
    dataThrough: latest?.toISOString() ?? null,
    methodology: {
      entry: 'sell_call_and_put_at_executable_bids',
      exit: 'buy_call_and_put_at_executable_asks',
      fees: 'taker_fees_on_entry_and_exit',
      horizonsHours: [...EVALUATED_HORIZONS],
      missedMarks: 'excluded_without_backfill',
      overlappingCohorts: 'downsampled_for_statistics',
      minimumMarkCoverage: MINIMUM_MARK_COVERAGE,
      pnlUnit: 'usd_per_normalized_base_quantity',
      interpretation: 'research_evidence_not_a_trade_recommendation',
    },
    segments,
  };
}

function summarizeSegment(
  unsorted: CompletedSample[],
  eligibleCohortCount: number,
  minimumSamples: number,
): ShortStraddleEvaluationSegment {
  const allSamples = [...unsorted].sort((a, b) => a.cohortAt.getTime() - b.cohortAt.getTime());
  const samples: CompletedSample[] = [];
  let nextEligibleCohortMs = Number.NEGATIVE_INFINITY;
  for (const sample of allSamples) {
    if (sample.cohortAt.getTime() < nextEligibleCohortMs) continue;
    samples.push(sample);
    nextEligibleCohortMs = sample.cohortAt.getTime() + sample.horizonHours * 3_600_000;
  }
  const pnl = samples.map((sample) => sample.pnlUsdPerUnit);
  const sortedPnl = [...pnl].sort((a, b) => a - b);
  const first = samples[0];
  const last = samples.at(-1);
  if (first == null || last == null) throw new Error('cannot summarize an empty segment');
  const totalPnlUsdPerUnit = sum(pnl);
  const confidenceInterval = meanConfidenceInterval95(pnl);
  const markCoverageRate = allSamples.length / eligibleCohortCount;
  const evidenceAvailable =
    samples.length >= minimumSamples && markCoverageRate >= MINIMUM_MARK_COVERAGE;
  return {
    venue: first.venue,
    underlying: first.underlying,
    horizonHours: first.horizonHours,
    status: evidenceAvailable ? 'evidence_available' : 'insufficient_data',
    assessment:
      !evidenceAvailable || confidenceInterval == null
        ? 'inconclusive'
        : confidenceInterval.low > 0
          ? 'positive_after_costs'
          : confidenceInterval.high < 0
            ? 'negative_after_costs'
            : 'inconclusive',
    eligibleCohortCount,
    sampleCount: allSamples.length,
    missingMarkCount: Math.max(0, eligibleCohortCount - allSamples.length),
    markCoverageRate,
    independentSampleCount: samples.length,
    overlappingSampleCountExcluded: allSamples.length - samples.length,
    profitableCount: pnl.filter((value) => value > 0).length,
    winRate: pnl.filter((value) => value > 0).length / samples.length,
    totalPnlUsdPerUnit,
    meanPnlUsdPerUnit: totalPnlUsdPerUnit / samples.length,
    meanPnl95ConfidenceLowUsdPerUnit: confidenceInterval?.low ?? null,
    meanPnl95ConfidenceHighUsdPerUnit: confidenceInterval?.high ?? null,
    medianPnlUsdPerUnit: median(sortedPnl),
    bestPnlUsdPerUnit: sortedPnl.at(-1) ?? 0,
    worstPnlUsdPerUnit: sortedPnl[0] ?? 0,
    meanPnlPctOfGrossCredit:
      sum(samples.map((sample) => sample.pnlPctOfGrossCredit)) / samples.length,
    meanCommonTopOfBookQuantity:
      sum(samples.map((sample) => sample.commonTopOfBookQuantity)) / samples.length,
    cumulativeUnitPnlMaxDrawdownUsd: maxDrawdown(pnl),
    firstCohortAt: first.cohortAt.toISOString(),
    lastCohortAt: last.cohortAt.toISOString(),
  };
}

function segmentKey(venue: string, horizonHours: Exclude<ShortStraddleHorizonHours, 0>): string {
  return `${venue}:${horizonHours}`;
}

function cohortKey(
  observation: Pick<
    PersistedShortStraddleSnapshot,
    'venue' | 'underlying' | 'cohortSlotTs'
  >,
): string {
  return `${observation.venue}:${observation.underlying.toUpperCase()}:${observation.cohortSlotTs.getTime()}`;
}

function isEvaluatedHorizon(
  horizon: ShortStraddleHorizonHours,
): horizon is Exclude<ShortStraddleHorizonHours, 0> {
  return horizon !== 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(sortedValues: number[]): number {
  const middle = Math.floor(sortedValues.length / 2);
  const upper = sortedValues[middle] ?? 0;
  if (sortedValues.length % 2 === 1) return upper;
  return ((sortedValues[middle - 1] ?? upper) + upper) / 2;
}

function maxDrawdown(pnl: number[]): number {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of pnl) {
    cumulative += value;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return drawdown;
}

function meanConfidenceInterval95(values: number[]): { low: number; high: number } | null {
  if (values.length < 2) return null;
  const mean = sum(values) / values.length;
  const variance = sum(values.map((value) => (value - mean) ** 2)) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { low: mean - margin, high: mean + margin };
}
