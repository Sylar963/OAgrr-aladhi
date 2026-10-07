import { createHash } from 'node:crypto';

import type {
  PortfolioAssistantFeedbackRecord,
  PortfolioAssistantFeedbackReportSource,
} from '@oggregator/db';

export const FEEDBACK_REASONS = [
  'wrong_numbers',
  'did_not_answer',
  'too_long',
  'refused',
  'other',
] as const;

const ANSWER_CHAR_LIMIT = 6_000;

export interface FeedbackReportInput {
  source: PortfolioAssistantFeedbackReportSource;
  buffered: PortfolioAssistantFeedbackRecord[];
  since: Date;
  generatedAt: Date;
  /** Synthetic eval fixtures, used to say which question topics are already covered. */
  fixtures: Array<{ id: string; question: string }>;
}

export interface FeedbackRunTelemetryView {
  requestId: string | null;
  outcome: string | null;
  durationMs: number | null;
  toolTotal: number | null;
  toolsByName: Record<string, number>;
  toolFailures: number;
}

export interface DownVoteEntry {
  userHash: string;
  messageId: string;
  threadId: string;
  votedAt: string;
  answeredAt: string | null;
  reasons: string[];
  note: string | null;
  question: string | null;
  answer: string | null;
  topic: QuestionTopic;
  telemetry: FeedbackRunTelemetryView | null;
  pendingFlush: boolean;
}

export type QuestionTopic =
  | 'max_loss_risk_budget'
  | 'greeks_exposure'
  | 'pnl_history_fees'
  | 'trade_idea_structure'
  | 'hedging'
  | 'expiry_horizon_scenario'
  | 'market_volatility'
  | 'other';

export interface CandidateFixturePattern {
  key: string;
  count: number;
  topic: QuestionTopic;
  reasons: string[];
  toolProfile: string;
  answerLength: string;
  coveredByFixtures: string[];
  suggestedFixtureId: string;
  suggestedChecks: string[];
}

export interface FeedbackReportSummary {
  generatedAt: string;
  since: string;
  sources: { databaseRows: number; bufferedRows: number; bufferedOnly: number };
  totals: { votes: number; up: number; down: number; downRate: number | null; voters: number };
  downReasons: Record<string, number>;
  downWithoutReason: number;
  downWithNote: number;
  telemetry: {
    downWithTelemetry: number;
    downWithoutTelemetry: number;
    downWithToolFailures: number;
    downWithNoToolCalls: number;
    downOutcomes: Record<string, number>;
  };
  patterns: CandidateFixturePattern[];
}

export interface FeedbackReport {
  summary: FeedbackReportSummary;
  downVotes: DownVoteEntry[];
  markdown: string;
}

interface MergedVote {
  record: PortfolioAssistantFeedbackRecord;
  fromBuffer: boolean;
  question: string | null;
  answer: string | null;
  answeredAt: Date | null;
}

/** Same digest as the `userIdHash` log field, shortened; correlate by prefix. */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 16);
}

const TOPIC_PATTERNS: Array<[QuestionTopic, RegExp]> = [
  [
    'max_loss_risk_budget',
    /\b(max(imum)?\s+loss|most i can lose|worst|risk budget|budget|downside|blow ?up)\b/i,
  ],
  ['hedging', /\bhedg/i],
  ['pnl_history_fees', /\b(pnl|p&l|profit|realized|realised|fees?|fills?|history|paid)\b/i],
  ['greeks_exposure', /\b(delta|gamma|theta|vega|greeks?|exposure)\b/i],
  [
    'expiry_horizon_scenario',
    /\b(expir\w*|days?|weeks?|if (btc|eth|spot)|scenario|by (friday|month))\b|[+-]\s?\d+\s?%/i,
  ],
  [
    'trade_idea_structure',
    /\b(spread|condor|straddle|strangle|butterfly|calls?|puts?|structure|trade|position|buy|sell)\b/i,
  ],
  ['market_volatility', /\b(iv|vol(atility)?|dvol|skew|surface|smile|flow|market|funding)\b/i],
];

export function classifyQuestion(question: string | null): QuestionTopic {
  if (!question) return 'other';
  for (const [topic, pattern] of TOPIC_PATTERNS) if (pattern.test(question)) return topic;
  return 'other';
}

function readTelemetry(value: Record<string, unknown> | null): FeedbackRunTelemetryView | null {
  if (!value) return null;
  const tools =
    value['toolCalls'] && typeof value['toolCalls'] === 'object'
      ? (value['toolCalls'] as Record<string, unknown>)
      : {};
  const number = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) ? input : null;
  const byTool =
    tools['byTool'] && typeof tools['byTool'] === 'object'
      ? Object.fromEntries(
          Object.entries(tools['byTool'] as Record<string, unknown>).flatMap(([name, count]) =>
            typeof count === 'number' ? [[name, count]] : [],
          ),
        )
      : {};
  return {
    requestId: typeof value['requestId'] === 'string' ? value['requestId'] : null,
    outcome: typeof value['outcome'] === 'string' ? value['outcome'] : null,
    durationMs: number(value['durationMs']),
    toolTotal: number(tools['total']),
    toolsByName: byTool,
    toolFailures:
      (number(tools['failed']) ?? 0) +
      (number(tools['timedOut']) ?? 0) +
      (number(tools['rejected']) ?? 0),
  };
}

function toolProfile(telemetry: FeedbackRunTelemetryView | null): string {
  if (!telemetry || telemetry.toolTotal == null) return 'telemetry_unavailable';
  if (telemetry.toolTotal === 0) return 'no_tool_calls';
  if (telemetry.toolFailures > 0) return 'tool_errors';
  const structure = Object.keys(telemetry.toolsByName).some((name) =>
    /evaluate_structure|structure_search|hedge/.test(name),
  );
  return structure ? 'structure_tools_ok' : 'market_tools_ok';
}

function answerLength(answer: string | null): string {
  if (answer == null) return 'unknown';
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  if (words <= 120) return 'short(<=120w)';
  if (words <= 350) return 'medium(121-350w)';
  return 'long(>350w)';
}

const REASON_CHECKS: Record<string, string> = {
  wrong_numbers:
    'Assert each number the question asks for against engine-derived expected values (context facts or evaluate_structure output), with a tolerance.',
  did_not_answer: 'Assert the answer states the asked quantity or decision in its first paragraph.',
  too_long: 'Add a word-count ceiling for this question type.',
  refused:
    'Assert no refusal or "cannot provide advice" phrasing when the context holds the data needed.',
  other: 'Owner to define the check from the reviewed notes.',
};

const PROFILE_CHECKS: Record<string, string> = {
  no_tool_calls:
    'Require the tool the question needs (requiredTools) so a context-only guess fails.',
  tool_errors:
    'Include a tool-error path (unresolvable ref, unknown expiry) and assert graceful recovery.',
};

function buildPatterns(
  downVotes: DownVoteEntry[],
  fixtures: Array<{ id: string; question: string }>,
): CandidateFixturePattern[] {
  const fixtureTopics = fixtures.map((fixture) => ({
    id: fixture.id,
    topic: classifyQuestion(fixture.question),
  }));
  const groups = new Map<string, CandidateFixturePattern>();
  for (const vote of downVotes) {
    const reasons = vote.reasons.length > 0 ? [...vote.reasons].sort() : ['unspecified'];
    const profile = toolProfile(vote.telemetry);
    const length = answerLength(vote.answer);
    const key = `${vote.topic}|${reasons.join('+')}|${profile}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const checks = [
      ...reasons.flatMap((reason) => (REASON_CHECKS[reason] ? [REASON_CHECKS[reason]] : [])),
      ...(PROFILE_CHECKS[profile] ? [PROFILE_CHECKS[profile]] : []),
    ];
    groups.set(key, {
      key,
      count: 1,
      topic: vote.topic,
      reasons,
      toolProfile: profile,
      answerLength: length,
      coveredByFixtures: fixtureTopics
        .filter((fixture) => fixture.topic === vote.topic)
        .map((fixture) => fixture.id),
      suggestedFixtureId: `feedback-${vote.topic.replaceAll('_', '-')}-${reasons[0]!.replaceAll('_', '-')}`,
      suggestedChecks: checks.length > 0 ? checks : ['Owner to define the check from the review.'],
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function quote(text: string, limit = Number.POSITIVE_INFINITY): string {
  const clipped =
    text.length > limit
      ? `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`
      : text;
  return clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function renderMarkdown(summary: FeedbackReportSummary, downVotes: DownVoteEntry[]): string {
  const lines: string[] = [
    `# Ask Hermes feedback report (${summary.generatedAt.slice(0, 10)})`,
    '',
    'PRIVATE: contains user questions and answers. Keep under `.eval-out/`; never commit, share, or paste into Hermes skills.',
    '',
    `Window: votes updated since ${summary.since}. Sources: ${summary.sources.databaseRows} database row(s), ${summary.sources.bufferedRows} buffered (not yet flushed; ${summary.sources.bufferedOnly} only in the buffer).`,
    '',
    '## Totals',
    '',
    '| Votes | Up | Down | Down rate | Voters |',
    '| --- | --- | --- | --- | --- |',
    `| ${summary.totals.votes} | ${summary.totals.up} | ${summary.totals.down} | ${summary.totals.downRate == null ? 'n/a' : `${(summary.totals.downRate * 100).toFixed(1)}%`} | ${summary.totals.voters} |`,
    '',
    '## Down-vote reasons',
    '',
    '| Reason | Count |',
    '| --- | --- |',
    ...Object.entries(summary.downReasons).map(([reason, count]) => `| ${reason} | ${count} |`),
    `| (no reason) | ${summary.downWithoutReason} |`,
    '',
    `Down votes with a note: ${summary.downWithNote}.`,
    '',
    '## Run telemetry on down votes',
    '',
    `With telemetry: ${summary.telemetry.downWithTelemetry}; without: ${summary.telemetry.downWithoutTelemetry} (vote cast after a backend restart or more than 24 h after the answer; find the run by \`assistantMessageId\` in the \`portfolio assistant model run completed\` journal line).`,
    `With tool failures/timeouts/rejections: ${summary.telemetry.downWithToolFailures}. With no tool calls: ${summary.telemetry.downWithNoToolCalls}.`,
    `Run outcomes: ${
      Object.entries(summary.telemetry.downOutcomes)
        .map(([outcome, count]) => `${outcome} ${count}`)
        .join(', ') || 'none'
    }.`,
    '',
    '## Down-voted answers',
    '',
  ];
  if (downVotes.length === 0) lines.push('None in this window.', '');
  downVotes.forEach((vote, index) => {
    const telemetry = vote.telemetry;
    lines.push(
      `### ${index + 1}. ${vote.topic} - ${vote.reasons.join(', ') || 'no reason'}`,
      '',
      `- user: \`${vote.userHash}\` · message: \`${vote.messageId}\` · thread: \`${vote.threadId}\``,
      `- answered: ${vote.answeredAt ?? 'unknown'} · voted: ${vote.votedAt}${vote.pendingFlush ? ' · buffered (not yet in DB)' : ''}`,
      telemetry
        ? `- run: requestId \`${telemetry.requestId ?? 'n/a'}\` · outcome ${telemetry.outcome ?? 'n/a'} · ${telemetry.durationMs == null ? 'n/a' : `${Math.round(telemetry.durationMs)} ms`} · tools ${telemetry.toolTotal ?? 'n/a'} (${
            Object.entries(telemetry.toolsByName)
              .map(([name, count]) => `${name} ${count}`)
              .join(', ') || 'none'
          }) · tool failures ${telemetry.toolFailures}`
        : '- run: telemetry unavailable',
      ...(vote.note ? [`- note: ${vote.note.replaceAll('\n', ' ')}`] : []),
      '',
      '**Question**',
      '',
      vote.question ? quote(vote.question) : '> (not found: thread deleted or expired)',
      '',
      '**Answer**',
      '',
      vote.answer
        ? quote(vote.answer, ANSWER_CHAR_LIMIT)
        : '> (not found: thread deleted or expired)',
      '',
    );
  });
  lines.push(
    '## Candidate eval fixtures',
    '',
    'Failure patterns without user data. Turn each into a synthetic fixture (see `src/assistant-eval/EVAL.md`, "From feedback to fixtures"); write a new question and book, never reuse a user\'s.',
    '',
  );
  if (summary.patterns.length === 0) lines.push('No down votes, so no patterns.', '');
  for (const pattern of summary.patterns) {
    lines.push(
      `### ${pattern.suggestedFixtureId} (${pattern.count} down vote${pattern.count === 1 ? '' : 's'})`,
      '',
      '```json',
      JSON.stringify(
        {
          topic: pattern.topic,
          reasons: pattern.reasons,
          toolProfile: pattern.toolProfile,
          answerLength: pattern.answerLength,
          coveredByFixtures: pattern.coveredByFixtures,
          suggestedChecks: pattern.suggestedChecks,
        },
        null,
        2,
      ),
      '```',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function buildFeedbackReport(input: FeedbackReportInput): Promise<FeedbackReport> {
  const merged = new Map<string, MergedVote>();
  const key = (record: PortfolioAssistantFeedbackRecord) =>
    `${record.userId}\u0000${record.messageId}`;
  const databaseRows = await input.source.listFeedbackSince(input.since);
  for (const row of databaseRows) {
    merged.set(key(row), {
      record: row,
      fromBuffer: false,
      question: row.question,
      answer: row.answer,
      answeredAt: row.answeredAt,
    });
  }
  const buffered = input.buffered.filter((row) => row.updatedAt >= input.since);
  let bufferedOnly = 0;
  for (const row of buffered) {
    const existing = merged.get(key(row));
    if (!existing) bufferedOnly += 1;
    if (existing && existing.record.updatedAt > row.updatedAt) continue;
    merged.set(key(row), {
      record: { ...row, runTelemetry: row.runTelemetry ?? existing?.record.runTelemetry ?? null },
      fromBuffer: true,
      question: existing?.question ?? null,
      answer: existing?.answer ?? null,
      answeredAt: existing?.answeredAt ?? null,
    });
  }

  const missing = [...merged.values()].filter(
    (vote) => vote.record.vote === 'down' && vote.answer == null,
  );
  if (missing.length > 0) {
    const exchanges = await input.source.loadExchanges(
      missing.map((vote) => ({ userId: vote.record.userId, messageId: vote.record.messageId })),
    );
    const byKey = new Map(exchanges.map((row) => [`${row.userId}\u0000${row.messageId}`, row]));
    for (const vote of missing) {
      const exchange = byKey.get(key(vote.record));
      if (!exchange) continue;
      vote.question = exchange.question;
      vote.answer = exchange.answer;
      vote.answeredAt = exchange.answeredAt;
    }
  }

  const votes = [...merged.values()];
  const downs = votes
    .filter((vote) => vote.record.vote === 'down')
    .sort((a, b) => b.record.updatedAt.getTime() - a.record.updatedAt.getTime());
  const downVotes: DownVoteEntry[] = downs.map((vote) => ({
    userHash: hashUserId(vote.record.userId),
    messageId: vote.record.messageId,
    threadId: vote.record.threadId,
    votedAt: vote.record.updatedAt.toISOString(),
    answeredAt: vote.answeredAt?.toISOString() ?? null,
    reasons: vote.record.reasons,
    note: vote.record.note,
    question: vote.question,
    answer: vote.answer,
    topic: classifyQuestion(vote.question),
    telemetry: readTelemetry(vote.record.runTelemetry),
    pendingFlush: vote.fromBuffer,
  }));

  const downReasons = Object.fromEntries(FEEDBACK_REASONS.map((reason) => [reason, 0])) as Record<
    string,
    number
  >;
  for (const vote of downVotes) {
    for (const reason of vote.reasons) downReasons[reason] = (downReasons[reason] ?? 0) + 1;
  }
  const downOutcomes: Record<string, number> = {};
  for (const vote of downVotes) {
    if (!vote.telemetry?.outcome) continue;
    downOutcomes[vote.telemetry.outcome] = (downOutcomes[vote.telemetry.outcome] ?? 0) + 1;
  }
  const up = votes.length - downs.length;
  const summary: FeedbackReportSummary = {
    generatedAt: input.generatedAt.toISOString(),
    since: input.since.toISOString(),
    sources: { databaseRows: databaseRows.length, bufferedRows: buffered.length, bufferedOnly },
    totals: {
      votes: votes.length,
      up,
      down: downs.length,
      downRate: votes.length > 0 ? downs.length / votes.length : null,
      voters: new Set(votes.map((vote) => vote.record.userId)).size,
    },
    downReasons,
    downWithoutReason: downVotes.filter((vote) => vote.reasons.length === 0).length,
    downWithNote: downVotes.filter((vote) => vote.note != null).length,
    telemetry: {
      downWithTelemetry: downVotes.filter((vote) => vote.telemetry != null).length,
      downWithoutTelemetry: downVotes.filter((vote) => vote.telemetry == null).length,
      downWithToolFailures: downVotes.filter((vote) => (vote.telemetry?.toolFailures ?? 0) > 0)
        .length,
      downWithNoToolCalls: downVotes.filter((vote) => vote.telemetry?.toolTotal === 0).length,
      downOutcomes,
    },
    patterns: buildPatterns(downVotes, input.fixtures),
  };
  return { summary, downVotes, markdown: renderMarkdown(summary, downVotes) };
}
