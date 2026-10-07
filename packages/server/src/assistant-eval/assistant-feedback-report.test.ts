import type {
  PortfolioAssistantFeedbackRecord,
  PortfolioAssistantFeedbackReportRow,
  PortfolioAssistantFeedbackReportSource,
} from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';

import { buildFeedbackReport, classifyQuestion, hashUserId } from './assistant-feedback-report.js';

const SINCE = new Date('2026-09-07T00:00:00.000Z');
const NOW = new Date('2026-10-07T12:00:00.000Z');
const THREAD = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(
  n: number,
  overrides: Partial<PortfolioAssistantFeedbackReportRow> = {},
): PortfolioAssistantFeedbackReportRow {
  return {
    userId: 'usr_alice',
    messageId: id(n),
    threadId: THREAD,
    vote: 'up',
    reasons: [],
    note: null,
    runTelemetry: null,
    createdAt: new Date('2026-10-06T10:00:00.000Z'),
    updatedAt: new Date('2026-10-06T10:00:00.000Z'),
    answeredAt: new Date('2026-10-06T09:59:00.000Z'),
    question: null,
    answer: null,
    ...overrides,
  };
}

function fakeSource(
  rows: PortfolioAssistantFeedbackReportRow[],
  exchanges: Record<string, { question: string; answer: string }> = {},
) {
  return {
    listFeedbackSince: vi.fn(async (since: Date) => rows.filter((item) => item.updatedAt >= since)),
    loadExchanges: vi.fn(async (refs: Array<{ userId: string; messageId: string }>) =>
      refs.flatMap((ref) => {
        const exchange = exchanges[ref.messageId];
        return exchange
          ? [
              {
                ...ref,
                threadId: THREAD,
                answeredAt: new Date('2026-10-07T09:00:00.000Z'),
                ...exchange,
              },
            ]
          : [];
      }),
    ),
    dispose: vi.fn(async () => undefined),
  } satisfies PortfolioAssistantFeedbackReportSource;
}

const TELEMETRY = {
  requestId: 'req-42',
  outcome: 'complete',
  durationMs: 8_000,
  toolCalls: {
    total: 2,
    byTool: { oggregator_option_chain: 2 },
    failed: 1,
    timedOut: 0,
    rejected: 0,
  },
};

describe('buildFeedbackReport', () => {
  it('summarizes totals, reasons and down-voted answers with hashed users', async () => {
    const source = fakeSource([
      row(1),
      row(2, { userId: 'usr_bob' }),
      row(3, {
        vote: 'down',
        reasons: ['wrong_numbers'],
        note: 'max loss is off',
        runTelemetry: TELEMETRY,
        question: 'What is the most I can lose on this book?',
        answer: 'You can lose $1,000,000.',
      }),
      row(4, { updatedAt: new Date('2026-08-01T00:00:00.000Z') }),
    ]);
    const report = await buildFeedbackReport({
      source,
      buffered: [],
      since: SINCE,
      generatedAt: NOW,
      fixtures: [
        { id: 'reference-max-loss', question: 'What is the most I can lose on this book?' },
      ],
    });

    expect(report.summary.totals).toEqual({ votes: 3, up: 2, down: 1, downRate: 1 / 3, voters: 2 });
    expect(report.summary.downReasons).toMatchObject({ wrong_numbers: 1, too_long: 0 });
    expect(report.summary.telemetry).toMatchObject({
      downWithTelemetry: 1,
      downWithToolFailures: 1,
    });
    expect(report.markdown).not.toContain('usr_alice');
    expect(report.markdown).toContain(hashUserId('usr_alice'));
    expect(report.markdown).toContain('> What is the most I can lose on this book?');
    expect(report.markdown).toContain('> You can lose $1,000,000.');
    expect(report.markdown).toContain('requestId `req-42`');
    expect(report.markdown).toContain('- note: max loss is off');
    expect(
      report.markdown
        .trimEnd()
        .split('\n')
        .some((line) => line === '## Candidate eval fixtures'),
    ).toBe(true);
  });

  it('keeps user content and identifiers out of the candidate fixture patterns', async () => {
    const report = await buildFeedbackReport({
      source: fakeSource([
        row(1, {
          vote: 'down',
          reasons: ['wrong_numbers'],
          runTelemetry: TELEMETRY,
          question: 'What is my max loss on the 95k puts for account acct_secret?',
          answer: 'Secret answer text',
          note: 'private note',
        }),
        row(2, {
          vote: 'down',
          reasons: ['wrong_numbers'],
          runTelemetry: TELEMETRY,
          question: 'Worst case loss if BTC drops?',
          answer: 'Another answer',
        }),
      ]),
      buffered: [],
      since: SINCE,
      generatedAt: NOW,
      fixtures: [
        { id: 'reference-max-loss', question: 'What is the most I can lose on this book?' },
      ],
    });

    expect(report.summary.patterns).toEqual([
      expect.objectContaining({
        count: 2,
        topic: 'max_loss_risk_budget',
        reasons: ['wrong_numbers'],
        toolProfile: 'tool_errors',
        coveredByFixtures: ['reference-max-loss'],
        suggestedFixtureId: 'feedback-max-loss-risk-budget-wrong-numbers',
      }),
    ]);
    const summary = JSON.stringify(report.summary);
    for (const secret of [
      'acct_secret',
      '95k',
      'Secret answer',
      'private note',
      'usr_alice',
      id(1),
    ]) {
      expect(summary).not.toContain(secret);
    }
    const patternsSection = report.markdown.split('## Candidate eval fixtures')[1]!;
    expect(patternsSection).not.toContain('acct_secret');
    expect(patternsSection).not.toContain('private note');
  });

  it('merges buffered votes over database rows and loads their exchanges', async () => {
    const buffered: PortfolioAssistantFeedbackRecord[] = [
      {
        ...row(1),
        vote: 'down',
        reasons: ['refused'],
        updatedAt: new Date('2026-10-07T11:00:00.000Z'),
      },
      {
        ...row(9),
        vote: 'down',
        reasons: ['too_long'],
        updatedAt: new Date('2026-10-07T11:30:00.000Z'),
      },
    ];
    const source = fakeSource([row(1)], {
      [id(1)]: { question: 'Explain theta on my book', answer: 'Theta is...' },
      [id(9)]: { question: 'What is IV doing?', answer: 'IV is...' },
    });
    const report = await buildFeedbackReport({
      source,
      buffered,
      since: SINCE,
      generatedAt: NOW,
      fixtures: [],
    });

    expect(report.summary.sources).toEqual({ databaseRows: 1, bufferedRows: 2, bufferedOnly: 1 });
    expect(report.summary.totals).toMatchObject({ votes: 2, up: 0, down: 2 });
    expect(source.loadExchanges).toHaveBeenCalledTimes(1);
    expect(report.downVotes.map((vote) => [vote.topic, vote.pendingFlush])).toEqual([
      ['market_volatility', true],
      ['greeks_exposure', true],
    ]);
    expect(report.markdown).toContain('telemetry unavailable');
  });

  it('reports an empty window', async () => {
    const report = await buildFeedbackReport({
      source: fakeSource([]),
      buffered: [],
      since: SINCE,
      generatedAt: NOW,
      fixtures: [],
    });
    expect(report.summary.totals.downRate).toBeNull();
    expect(report.markdown).toContain('No down votes, so no patterns.');
  });
});

describe('classifyQuestion', () => {
  it.each([
    ['What is the most I can lose?', 'max_loss_risk_budget'],
    ['How do I hedge my short puts?', 'hedging'],
    ['What fees did I pay?', 'pnl_history_fees'],
    ['Which expiry has the most negative theta?', 'greeks_exposure'],
    ['Suggest a bear put spread', 'trade_idea_structure'],
    ['Is IV rich right now?', 'market_volatility'],
    ['hello', 'other'],
  ])('%s -> %s', (question, topic) => {
    expect(classifyQuestion(question)).toBe(topic);
  });
});
