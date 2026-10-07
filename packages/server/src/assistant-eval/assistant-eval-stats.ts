import type { AssistantEvalCheckName, AssistantEvalGrade } from './assistant-eval-checks.js';

const Z_95 = 1.959964;

export interface ProportionInterval {
  low: number;
  high: number;
}

/** Wilson score interval for a binomial proportion; null without trials. */
export function wilsonInterval(successes: number, trials: number, z = Z_95): ProportionInterval | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export interface SampledGrade {
  fixtureId: string;
  grade: AssistantEvalGrade;
}

export interface FixtureSampleSummary {
  fixtureId: string;
  passed: number;
  samples: number;
  /** Strictly more than half the samples passed. */
  majorityPass: boolean;
  failedChecks: Partial<Record<AssistantEvalCheckName | 'error', number>>;
}

/** Per-fixture pass counts in first-seen order. A sample with an error counts as an `error` failure. */
export function summarizeFixtureSamples(
  runs: Array<SampledGrade & { error?: { code: string } | null }>,
): FixtureSampleSummary[] {
  const byFixture = new Map<string, FixtureSampleSummary>();
  for (const run of runs) {
    const summary = byFixture.get(run.fixtureId) ?? {
      fixtureId: run.fixtureId,
      passed: 0,
      samples: 0,
      majorityPass: false,
      failedChecks: {},
    };
    summary.samples += 1;
    if (run.grade.pass) summary.passed += 1;
    if (run.error != null) summary.failedChecks.error = (summary.failedChecks.error ?? 0) + 1;
    for (const check of run.grade.checks) {
      if (check.status === 'fail') {
        summary.failedChecks[check.check] = (summary.failedChecks[check.check] ?? 0) + 1;
      }
    }
    summary.majorityPass = summary.passed * 2 > summary.samples;
    byFixture.set(run.fixtureId, summary);
  }
  return [...byFixture.values()];
}

export interface OverallPassRate {
  passed: number;
  total: number;
  rate: number | null;
  interval: ProportionInterval | null;
}

export function overallPassRate(runs: SampledGrade[]): OverallPassRate {
  const passed = runs.filter((run) => run.grade.pass).length;
  return {
    passed,
    total: runs.length,
    rate: runs.length === 0 ? null : passed / runs.length,
    interval: wilsonInterval(passed, runs.length),
  };
}
