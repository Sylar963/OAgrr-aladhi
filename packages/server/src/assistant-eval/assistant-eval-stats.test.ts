import { describe, expect, it } from 'vitest';

import type { AssistantEvalGrade } from './assistant-eval-checks.js';
import { overallPassRate, summarizeFixtureSamples, wilsonInterval } from './assistant-eval-stats.js';

function grade(pass: boolean, failed: Array<'numbers' | 'structure'> = []): AssistantEvalGrade {
  return {
    pass,
    numbers: [],
    checks: [
      { check: 'numbers', status: failed.includes('numbers') ? 'fail' : 'pass', detail: '' },
      { check: 'structure', status: failed.includes('structure') ? 'fail' : 'not_applicable', detail: '' },
    ],
  };
}

describe('wilsonInterval', () => {
  it('returns null without trials', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  it('is symmetric around one half', () => {
    const interval = wilsonInterval(7, 14);
    expect(interval?.low).toBeCloseTo(0.268, 3);
    expect(interval?.high).toBeCloseTo(0.732, 3);
  });

  it('stays inside [0, 1] at the extremes', () => {
    const all = wilsonInterval(42, 42);
    expect(all?.low).toBeCloseTo(0.9162, 3);
    expect(all?.high).toBe(1);
    const none = wilsonInterval(0, 42);
    expect(none?.low).toBe(0);
    expect(none?.high).toBeCloseTo(0.0838, 3);
  });
});

describe('summarizeFixtureSamples', () => {
  it('counts passes, majority and failed checks per fixture', () => {
    const summaries = summarizeFixtureSamples([
      { fixtureId: 'a', grade: grade(true) },
      { fixtureId: 'b', grade: grade(false, ['structure']) },
      { fixtureId: 'a', grade: grade(false, ['numbers', 'structure']) },
      { fixtureId: 'a', grade: grade(true) },
      { fixtureId: 'b', grade: grade(false), error: { code: 'timeout' } },
    ]);
    expect(summaries).toEqual([
      { fixtureId: 'a', passed: 2, samples: 3, majorityPass: true, failedChecks: { numbers: 1, structure: 1 } },
      { fixtureId: 'b', passed: 0, samples: 2, majorityPass: false, failedChecks: { structure: 1, error: 1 } },
    ]);
  });

  it('does not count a tie as a majority', () => {
    const [summary] = summarizeFixtureSamples([
      { fixtureId: 'a', grade: grade(true) },
      { fixtureId: 'a', grade: grade(false) },
    ]);
    expect(summary?.majorityPass).toBe(false);
  });
});

describe('overallPassRate', () => {
  it('reports the sample pass rate with its interval', () => {
    const overall = overallPassRate([
      { fixtureId: 'a', grade: grade(true) },
      { fixtureId: 'a', grade: grade(false) },
    ]);
    expect(overall.passed).toBe(1);
    expect(overall.total).toBe(2);
    expect(overall.rate).toBe(0.5);
    expect(overall.interval).toEqual(wilsonInterval(1, 2));
  });
});
