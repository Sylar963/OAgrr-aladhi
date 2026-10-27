import { PortfolioAssistantEvidenceSchema } from '@oggregator/protocol';
import type { PortfolioAssistantContext } from '../portfolio-assistant-context-builder.js';
import type { AssistantEvalCheckResult, AssistantEvalGrade } from './assistant-eval-checks.js';

export function checkAssistantEvidence(
  raw: unknown,
  context: PortfolioAssistantContext,
): AssistantEvalCheckResult {
  const parsed = PortfolioAssistantEvidenceSchema.safeParse(raw);
  const fail = (detail: string): AssistantEvalCheckResult => ({
    check: 'evidence',
    status: 'fail',
    detail,
  });
  if (!parsed.success) return fail('Evidence is absent or fails the protocol schema.');
  const { snapshot, relevantLegIds, gaps, comparison } = parsed.data;
  if (
    snapshot.generatedAt !== context.generatedAt ||
    snapshot.source !== context.source ||
    snapshot.underlying !== context.underlying ||
    snapshot.forwardDays !== context.forwardDays
  )
    return fail('Snapshot scope differs from the answer context.');
  for (const key of [
    'spotUsd',
    'unrealizedPnlUsd',
    'netDeltaCoin',
    'netThetaUsd',
    'netVegaUsd',
  ] as const) {
    if (snapshot[key] !== context.headline[key])
      return fail(`Snapshot ${key} differs from the context, including null handling.`);
  }
  const ids = new Set(context.positions.map((leg) => leg.legId));
  if (relevantLegIds.some((id) => !ids.has(id)))
    return fail('Evidence references a position absent from the context.');
  if (context.limitations.some((gap) => !gaps.includes(gap)))
    return fail('Evidence omits a supplied data limitation.');
  if (
    comparison?.changes.some(
      (row) =>
        row.change !==
        (row.previous == null || row.current == null ? null : row.current - row.previous),
    )
  )
    return fail('Review differences are not reproducible arithmetic.');
  return {
    check: 'evidence',
    status: 'pass',
    detail:
      'Snapshot scope, values, position references, gaps and comparison arithmetic match. This checks metadata, not every prose claim.',
  };
}

export function summarizeAssistantQuality(
  runs: Array<{
    grade: AssistantEvalGrade;
    firstTokenMs?: number | null;
    estimatedCostUsd?: number | null;
  }>,
) {
  const firstTokens = runs
    .flatMap((run) => (run.firstTokenMs == null ? [] : [run.firstTokenMs]))
    .sort((a, b) => a - b);
  const costs = runs.flatMap((run) => (run.estimatedCostUsd == null ? [] : [run.estimatedCostUsd]));
  const passed = runs.filter((run) => run.grade.pass).length;
  const knownCostUsd = costs.reduce((sum, cost) => sum + cost, 0);
  const completeCostCoverage = runs.length > 0 && costs.length === runs.length;
  const percentile = (fraction: number) =>
    firstTokens.length === 0
      ? null
      : firstTokens[Math.max(0, Math.ceil(firstTokens.length * fraction) - 1)]!;
  return {
    firstTokenSamples: firstTokens.length,
    firstTokenP50Ms: percentile(0.5),
    firstTokenP95Ms: percentile(0.95),
    pricedRuns: costs.length,
    totalRuns: runs.length,
    knownCostUsd,
    totalEstimatedCostUsd: completeCostCoverage ? knownCostUsd : null,
    costPerSuccessfulAnswerUsd: completeCostCoverage && passed > 0 ? knownCostUsd / passed : null,
  };
}
