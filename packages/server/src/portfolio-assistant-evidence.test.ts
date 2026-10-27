import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PortfolioAssistantMessage } from '@oggregator/protocol';
import {
  AssistantEvalFixtureSchema,
  fixtureContext,
} from './assistant-eval/assistant-eval-fixture.js';
import {
  buildAssistantEvidence,
  compareAssistantSnapshots,
} from './portfolio-assistant-evidence.js';
import {
  selectAssistantContextPolicy,
  shapeAssistantContext,
} from './portfolio-assistant-context-policy.js';
import {
  checkAssistantEvidence,
  summarizeAssistantQuality,
} from './assistant-eval/assistant-eval-quality.js';
import { estimateAssistantCost, readAssistantTokenRates } from './portfolio-assistant-cost.js';

function context() {
  return fixtureContext(
    AssistantEvalFixtureSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('./assistant-eval/fixtures/reference-max-loss.json', import.meta.url),
          'utf8',
        ),
      ),
    ),
  );
}

describe('saved review evidence', () => {
  it('keeps missing values unknown, validates references, and never exposes private context handles', () => {
    const input = context();
    input.headline.unrealizedPnlUsd = null;
    input.limitations.push('Marks missing.');
    const evidence = buildAssistantEvidence(input, 'What is my risk?', []);
    expect(evidence.snapshot.unrealizedPnlUsd).toBeNull();
    expect(evidence.gaps).toContain('Marks missing.');
    expect(evidence.snapshot.positions.every((leg) => leg.markUpdatedAt === null)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain(input.portfolioRef);
    expect(checkAssistantEvidence(evidence, input).status).toBe('pass');
    expect(
      checkAssistantEvidence({ ...evidence, relevantLegIds: ['invented-leg'] }, input).status,
    ).toBe('fail');
    expect(
      checkAssistantEvidence(
        { ...evidence, snapshot: { ...evidence.snapshot, unrealizedPnlUsd: 0 } },
        input,
      ).status,
    ).toBe('fail');
  });

  it('compares the previous completed saved snapshot and preserves unknown deltas', () => {
    const input = context();
    input.headline.unrealizedPnlUsd = null;
    const previous = buildAssistantEvidence(input, 'Review', []);
    const history: PortfolioAssistantMessage[] = [
      {
        messageId: crypto.randomUUID(),
        role: 'assistant',
        content: 'Previous review',
        status: 'complete',
        portfolioGeneratedAt: input.generatedAt,
        createdAt: input.generatedAt,
        evidence: previous,
      },
    ];
    input.generatedAt += 60_000;
    input.headline.spotUsd = (input.headline.spotUsd ?? 0) + 100;
    input.headline.unrealizedPnlUsd = 200;
    input.positions[0]!.size += 1;
    const evidence = buildAssistantEvidence(input, 'What changed since my last review?', history);
    expect(evidence.comparison?.changes.find((row) => row.metric === 'spotUsd')?.change).toBe(100);
    expect(
      evidence.comparison?.changes.find((row) => row.metric === 'unrealizedPnlUsd')?.change,
    ).toBeNull();
    expect(evidence.comparison?.positionChanges).toHaveLength(1);
    expect(evidence.assumptions).toContain('changes_not_attribution');
    expect(
      buildAssistantEvidence(input, 'Review', [{ ...history[0]!, status: 'failed' }]).comparison,
    ).toBeNull();
  });

  it('refuses different scopes and does not invent removals from a truncated position list', () => {
    const first = buildAssistantEvidence(context(), 'Review', []).snapshot;
    const next = { ...first, generatedAt: first.generatedAt + 60_000 };
    for (const changed of [
      { source: 'paper' as const },
      { underlying: 'ETH' },
      { forwardDays: first.forwardDays + 1 },
      { network: 'testnet' as const },
    ]) {
      expect(compareAssistantSnapshots(first, { ...next, ...changed })).toBeNull();
    }
    expect(
      compareAssistantSnapshots(first, { ...next, positions: [], positionsTruncated: true }),
    ).toMatchObject({ positionsComparable: false, positionChanges: [] });
  });

  it('reconciles mark changes only for unchanged holdings and leaves the rest unattributed', () => {
    const first = buildAssistantEvidence(context(), 'Review', []).snapshot;
    first.unrealizedPnlUsd = 100;
    first.positions = [{ ...first.positions[0]!, size: -2, entryPriceUsd: 1000, markUsd: 1100 }];
    const next = {
      ...first,
      generatedAt: first.generatedAt + 60_000,
      unrealizedPnlUsd: 70,
      positions: [{ ...first.positions[0]!, markUsd: 1110 }],
    };
    const result = compareAssistantSnapshots(first, next);
    expect(result?.markPnlChanges?.[0]?.pnlChangeUsd).toBe(-20);
    expect(result?.unattributedPnlChangeUsd).toBe(-10);
    next.positions[0]!.size = -1;
    expect(compareAssistantSnapshots(first, next)?.markPnlChanges).toEqual([]);
    expect(compareAssistantSnapshots(first, next)?.unattributedPnlChangeUsd).toBe(-30);
  });
});

describe('selective context', () => {
  it.each([
    ['Which expiry contributes the most negative theta?', 'exposure'],
    ['¿Cuál vencimiento tiene la mayor theta negativa?', 'exposure'],
    ['Why did my account equity change?', 'accounting'],
    ['Explain gamma', 'theory'],
    ['What changed since my last review?', 'comparison'],
    ['Compare a hedge and tell me the total delta', 'portfolio'],
    ['What about that one?', 'portfolio'],
    ['Which expiry has most theta and why did equity change?', 'portfolio'],
  ])('routes %s conservatively to %s', (question, intent) => {
    expect(selectAssistantContextPolicy(question).intent).toBe(intent);
  });

  it('reduces context while preserving positions, risk bounds and missing-data limitations', () => {
    const full = context();
    const shaped = shapeAssistantContext(
      full,
      selectAssistantContextPolicy('Which expiry has the most theta?'),
    );
    expect(JSON.stringify(shaped).length).toBeLessThan(JSON.stringify(full).length);
    expect(shaped.riskBudgetFacts).toEqual(full.riskBudgetFacts);
    expect(shaped.positions).toEqual(full.positions);
    expect(shaped.limitations).toEqual(full.limitations);
    expect(shaped.marketFacts).toEqual({ underlyings: [], unavailable: [] });
    expect(shaped.horizonScenarios).toBeNull();
    expect(shaped.contextSelection?.omittedSections).toContain('accountEquityFacts');
  });
});

describe('measured cost and quality', () => {
  const rates = { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.2, outputUsdPerMillion: 10 };
  it('requires actual configured rates and known usage, including cached tokens', () => {
    expect(readAssistantTokenRates({})).toBeNull();
    expect(() => readAssistantTokenRates({ HERMES_INPUT_USD_PER_MILLION: '2' })).toThrow();
    expect(
      estimateAssistantCost(
        { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 100 },
        rates,
      ),
    ).toBeCloseTo(0.0021);
    expect(
      estimateAssistantCost(
        { inputTokens: 1000, cachedInputTokens: null, outputTokens: 100 },
        rates,
      ),
    ).toBeNull();
    expect(
      estimateAssistantCost(
        { inputTokens: 1000, cachedInputTokens: 1001, outputTokens: 100 },
        rates,
      ),
    ).toBeNull();
  });

  it('includes failed-run spend and refuses a complete cost metric with incomplete coverage', () => {
    const runs = [
      { grade: { pass: true, checks: [], numbers: [] }, firstTokenMs: 100, estimatedCostUsd: 0.01 },
      {
        grade: { pass: false, checks: [], numbers: [] },
        firstTokenMs: 300,
        estimatedCostUsd: 0.02,
      },
    ];
    expect(summarizeAssistantQuality(runs)).toMatchObject({
      costPerSuccessfulAnswerUsd: 0.03,
      firstTokenP50Ms: 100,
      firstTokenP95Ms: 300,
    });
    expect(
      summarizeAssistantQuality([...runs, { grade: { pass: true, checks: [], numbers: [] } }])
        .costPerSuccessfulAnswerUsd,
    ).toBeNull();
  });
});
