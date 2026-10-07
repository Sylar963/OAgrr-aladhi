import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { logger } from '@oggregator/core';
import { z } from 'zod';

import { MIN_ASSISTANT_MCP_TOKEN_LENGTH } from '../assistant-market/assistant-mcp-server.js';
import { AssistantMarketDataReader } from '../assistant-market/market-data-reader.js';
import { OptionsLibrary } from '../assistant-market/options-library.js';
import { HermesPortfolioAssistantGateway } from '../hermes-portfolio-assistant-gateway.js';
import {
  type PortfolioAssistantConfiguration,
  readPortfolioAssistantConfiguration,
} from '../portfolio-assistant-configuration.js';
import type { PortfolioAssistantContext } from '../portfolio-assistant-context-builder.js';
import {
  PortfolioAssistantServiceError,
  type StreamPortfolioAnswerRequest,
} from '../portfolio-assistant-model-gateway.js';
import { PortfolioAssistantPromptBuilder } from '../portfolio-assistant-prompt-builder.js';
import {
  type AssistantEvalCheckSummary,
  type AssistantEvalGrade,
  type AssistantEvalJudge,
  type AssistantEvalToolObservation,
  gradeAnswer,
  type HeldLegRef,
  summarizeChecks,
} from './assistant-eval-checks.js';
import {
  type AssistantEvalFixture,
  AssistantEvalFixtureSchema,
  fixtureContext,
} from './assistant-eval-fixture.js';
import {
  type FixtureSampleSummary,
  type OverallPassRate,
  overallPassRate,
  summarizeFixtureSamples,
} from './assistant-eval-stats.js';
import { matchEvalToolCalls, registryObservation, toolUsageCell } from './assistant-eval-tool-log.js';
import {
  AssistantEvalMcp,
  EVAL_MCP_DEFAULT_PORT,
  EVAL_MCP_PORT_ENV,
  EVAL_MCP_TOKEN_ENV,
  type EvalRunToolCall,
  httpMarketInjector,
} from './eval-mcp-server.js';
import { type SyntheticMarket, syntheticMarketForContext } from './synthetic-market.js';

const log = logger.child({ component: 'assistant-eval' });
const execFileAsync = promisify(execFile);

const FIXTURE_DIRECTORY = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DEFAULT_OUT_DIRECTORY = fileURLToPath(new URL('../../.eval-out/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TOOL_LOG_SETTLE_MS = 1_500;
const MAX_CONCURRENCY = 3;
const PRODUCTION_PROFILE_SEGMENT = '/p/portfolio-chat/';
const EVAL_PROFILE_SEGMENT = '/p/portfolio-chat-eval/';

const ArgsSchema = z.object({
  fixture: z.array(z.string().min(1)).default([]),
  'dry-run': z.boolean().default(false),
  out: z.string().min(1).default(DEFAULT_OUT_DIRECTORY),
  'timeout-ms': z.coerce.number().int().positive().optional(),
  mcp: z.enum(['eval', 'live']).default('eval'),
  'mcp-port': z.coerce.number().int().min(1).max(65_535).optional(),
  'live-api-url': z.string().min(1).optional(),
  'tool-logs': z.enum(['journal', 'none']).default('journal'),
  'journal-unit': z.string().min(1).default('ogg-backend.service'),
  samples: z.coerce.number().int().min(1).max(10).default(3),
  concurrency: z.coerce.number().int().min(1).max(MAX_CONCURRENCY).default(1),
  regrade: z.string().min(1).optional(),
});
type EvalArgs = z.infer<typeof ArgsSchema>;

interface LoadedFixtures {
  fixtures: AssistantEvalFixture[];
  invalid: Array<{ file: string; error: string }>;
}

interface PromptParts {
  request: StreamPortfolioAnswerRequest;
  systemChars: number;
  contextChars: number;
  conversationChars: number;
}

interface FixtureRun {
  fixtureId: string;
  sample: number;
  scenario: AssistantEvalFixture['scenario'];
  question: string;
  answer: string;
  error: { code: string; message: string } | null;
  durationMs: number;
  usage: { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null } | null;
  promptChars: { system: number; context: number; conversation: number };
  tools: AssistantEvalToolObservation;
  // Exact per-call records from the eval MCP server; null when tools came from the journal.
  toolCalls: EvalRunToolCall[] | null;
  grade: AssistantEvalGrade;
  judge: { name: string; score: number; rationale: string } | null;
}

function heldLegs(fixture: AssistantEvalFixture): HeldLegRef[] {
  return fixture.context.positions
    .filter((position) => position.size !== 0)
    .map(({ expiry, strike, optionRight }) => ({ expiry, strike, optionRight }));
}

function readArgs(argv: string[]): EvalArgs {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== '--'),
    options: {
      fixture: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
      out: { type: 'string' },
      'timeout-ms': { type: 'string' },
      mcp: { type: 'string' },
      'mcp-port': { type: 'string' },
      'live-api-url': { type: 'string' },
      'tool-logs': { type: 'string' },
      'journal-unit': { type: 'string' },
      samples: { type: 'string' },
      concurrency: { type: 'string' },
      regrade: { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  return ArgsSchema.parse(values);
}

function loadFixtures(filter: string[]): LoadedFixtures {
  const files = readdirSync(FIXTURE_DIRECTORY)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const fixtures: AssistantEvalFixture[] = [];
  const invalid: LoadedFixtures['invalid'] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(FIXTURE_DIRECTORY, file), 'utf8'));
    } catch (error) {
      invalid.push({ file, error: error instanceof Error ? error.message : 'unreadable JSON' });
      continue;
    }
    const parsed = AssistantEvalFixtureSchema.safeParse(raw);
    if (!parsed.success) {
      invalid.push({ file, error: z.prettifyError(parsed.error) });
      continue;
    }
    if (`${parsed.data.id}.json` !== file) {
      invalid.push({ file, error: `id ${parsed.data.id} does not match the file name` });
      continue;
    }
    fixtures.push(parsed.data);
  }
  const unknown = filter.filter((id) => !fixtures.some((fixture) => fixture.id === id));
  if (unknown.length > 0) throw new Error(`Unknown fixture id(s): ${unknown.join(', ')}`);
  return {
    fixtures: filter.length === 0 ? fixtures : fixtures.filter((fixture) => filter.includes(fixture.id)),
    invalid,
  };
}

function buildPrompt(
  builder: PortfolioAssistantPromptBuilder,
  fixture: AssistantEvalFixture,
  context: PortfolioAssistantContext,
  threadId: string,
): PromptParts {
  const systemInstructions = builder.buildPortfolioAssistantSystemInstructions();
  const contextMessage = builder.buildPortfolioAssistantContextMessage(context);
  const conversationMessages = builder.buildPortfolioAssistantConversationMessages(
    fixture.history,
    fixture.question,
  );
  return {
    request: { threadId, systemInstructions, contextMessage, conversationMessages },
    systemChars: systemInstructions.length,
    contextChars: contextMessage.length,
    conversationChars: conversationMessages.reduce((sum, message) => sum + message.content.length, 0),
  };
}

function evalProfileUrl(env: NodeJS.ProcessEnv, productionUrl: string): string {
  const explicit = env['HERMES_PORTFOLIO_EVAL_API_URL']?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  if (!productionUrl.includes(PRODUCTION_PROFILE_SEGMENT)) {
    throw new Error('Set HERMES_PORTFOLIO_EVAL_API_URL to the portfolio-chat-eval profile route (see EVAL.md).');
  }
  return productionUrl.replace(PRODUCTION_PROFILE_SEGMENT, EVAL_PROFILE_SEGMENT);
}

function evalConfiguration(
  env: NodeJS.ProcessEnv,
  args: EvalArgs,
): PortfolioAssistantConfiguration {
  // The eval must run while the product flag is off, so the enabled-only checks are applied here.
  const base = readPortfolioAssistantConfiguration({ ...env, PORTFOLIO_ASSISTANT_ENABLED: 'false' });
  const apiUrl = args.mcp === 'eval' ? evalProfileUrl(env, base.apiUrl) : base.apiUrl;
  if (args.mcp === 'eval' && apiUrl === base.apiUrl) {
    throw new Error('--mcp eval must not use the production Hermes profile; its MCP server cannot resolve eval refs.');
  }
  const apiKey =
    (args.mcp === 'eval' ? env['HERMES_PORTFOLIO_EVAL_API_KEY']?.trim() : undefined) || base.apiKey;
  if (!apiKey) throw new Error('HERMES_PORTFOLIO_API_KEY is not set (checked process env and ../../.env).');
  try {
    new URL(apiUrl);
  } catch {
    throw new Error('The Hermes API URL must be an absolute URL.');
  }
  return {
    ...base,
    enabled: true,
    apiUrl,
    apiKey,
    model: (args.mcp === 'eval' ? env['HERMES_PORTFOLIO_EVAL_MODEL']?.trim() : undefined) || base.model,
    requestTimeoutMs: args['timeout-ms'] ?? base.requestTimeoutMs,
  };
}

async function journalTools(
  args: EvalArgs,
  portfolioRef: string,
  startedAt: number,
  finishedAt: number,
): Promise<AssistantEvalToolObservation> {
  if (args['tool-logs'] === 'none') {
    return { observedTools: null, evidence: 'tool log inspection disabled (--tool-logs none)' };
  }
  await new Promise((resolve) => setTimeout(resolve, TOOL_LOG_SETTLE_MS));
  try {
    const { stdout } = await execFileAsync(
      'journalctl',
      [
        '--user',
        '-u',
        args['journal-unit'],
        '--since',
        `@${Math.floor(startedAt / 1000) - 1}`,
        '--until',
        `@${Math.ceil(finishedAt / 1000) + 2}`,
        '-o',
        'cat',
        '--no-pager',
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const match = matchEvalToolCalls(stdout, {
      startedAt,
      until: finishedAt + TOOL_LOG_SETTLE_MS,
      portfolioRef,
    });
    return {
      observedTools: match.tools,
      evidence:
        `backend journal (${args['journal-unit']}): ${match.matchedByRef} call(s) matched by fixture portfolioRef, ` +
        `${match.matchedByWindow} by request window only (concurrent users could add calls), ` +
        `${match.excludedOtherRuns} excluded as other runs`,
    };
  } catch {
    return { observedTools: null, evidence: 'backend journal unavailable, tool calls unverified' };
  }
}

interface RunEnvironment {
  gateway: HermesPortfolioAssistantGateway;
  builder: PortfolioAssistantPromptBuilder;
  runId: string;
  args: EvalArgs;
  judge: AssistantEvalJudge | null;
  mcp: AssistantEvalMcp | null;
}

async function runFixture(env: RunEnvironment, fixture: AssistantEvalFixture, sample: number): Promise<FixtureRun> {
  const threadId = `assistant-eval-${env.runId}-${fixture.id}-s${sample}`;
  const requestId = randomUUID();
  const started = env.mcp?.beginRun({ requestId, threadId, context: fixture.context }) ?? null;
  const context: PortfolioAssistantContext =
    started == null ? fixtureContext(fixture) : { ...fixtureContext(fixture), portfolioRef: started.portfolioRef };
  const prompt = buildPrompt(env.builder, fixture, context, threadId);
  const startedAt = Date.now();
  let answer = '';
  let usage: FixtureRun['usage'] = null;
  let error: FixtureRun['error'] = null;
  try {
    for await (const event of env.gateway.streamPortfolioAnswer(prompt.request, new AbortController().signal)) {
      if (event.type === 'text_delta') answer += event.delta;
      else
        usage = {
          inputTokens: event.inputTokens,
          cachedInputTokens: event.cachedInputTokens,
          outputTokens: event.outputTokens,
        };
    }
  } catch (caught) {
    error =
      caught instanceof PortfolioAssistantServiceError
        ? { code: caught.code, message: caught.message }
        : { code: 'unexpected', message: caught instanceof Error ? caught.message : 'unknown error' };
  }
  const finishedAt = Date.now();
  let tools: AssistantEvalToolObservation;
  let toolCalls: EvalRunToolCall[] | null = null;
  if (env.mcp != null) {
    const toolUsage = env.mcp.finishRun(requestId);
    tools = registryObservation(toolUsage);
    toolCalls = toolUsage.calls;
  } else {
    tools = await journalTools(env.args, fixture.context.portfolioRef, startedAt, finishedAt);
  }
  const grade = gradeAnswer(fixture.expect, answer, tools, heldLegs(fixture));
  const judged =
    env.judge == null || answer === ''
      ? null
      : { name: env.judge.name, ...(await env.judge.score({ fixtureId: fixture.id, question: fixture.question, answer })) };
  return {
    fixtureId: fixture.id,
    sample,
    scenario: fixture.scenario,
    question: fixture.question,
    answer,
    error,
    durationMs: finishedAt - startedAt,
    usage,
    promptChars: {
      system: prompt.systemChars,
      context: prompt.contextChars,
      conversation: prompt.conversationChars,
    },
    tools,
    toolCalls,
    grade: error == null ? grade : { ...grade, pass: false },
    judge: judged,
  };
}

function percent(value: number | null): string {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function checkTable(summary: AssistantEvalCheckSummary[]): string {
  return [
    '| Check | Pass | Fail | Unverified | N/A | Pass rate |',
    '| --- | --- | --- | --- | --- | --- |',
    ...summary.map(
      (row) =>
        `| ${row.check} | ${row.passed} | ${row.failed} | ${row.unverified} | ${row.notApplicable} | ${percent(row.passRate)} |`,
    ),
  ].join('\n');
}

function fixtureTable(summaries: FixtureSampleSummary[], runs: FixtureRun[]): string {
  return [
    '| Fixture | Passed | Majority | Failed checks (samples) | Tool calls, all samples |',
    '| --- | --- | --- | --- | --- |',
    ...summaries.map((summary) => {
      const failed = Object.entries(summary.failedChecks)
        .map(([check, count]) => `${check} ×${count}`)
        .join(', ');
      const fixtureRuns = runs.filter((run) => run.fixtureId === summary.fixtureId);
      return `| ${summary.fixtureId} | ${summary.passed}/${summary.samples} | ${summary.majorityPass ? 'pass' : 'FAIL'} | ${failed || '–'} | ${toolUsageCell(fixtureRuns)} |`;
    }),
  ].join('\n');
}

function sampleTable(runs: FixtureRun[]): string {
  return [
    '| Fixture | Sample | Result | Failed checks | Chars | Seconds |',
    '| --- | --- | --- | --- | --- | --- |',
    ...runs.map((run) => {
      const failed: string[] = run.grade.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.check);
      if (run.error) failed.unshift(`error:${run.error.code}`);
      return `| ${run.fixtureId} | ${run.sample} | ${run.grade.pass ? 'pass' : 'FAIL'} | ${failed.join(', ') || '-'} | ${run.answer.length} | ${(run.durationMs / 1000).toFixed(1)} |`;
    }),
  ].join('\n');
}

function answerMarkdown(run: FixtureRun): string {
  return [
    `# ${run.fixtureId} (sample ${run.sample})`,
    '',
    `**Question:** ${run.question}`,
    '',
    `**Result:** ${run.grade.pass ? 'pass' : 'FAIL'}${run.error ? ` (error ${run.error.code}: ${run.error.message})` : ''}`,
    '',
    ...run.grade.checks.map((check) => `- ${check.check}: ${check.status} — ${check.detail}`),
    '',
    `**Tool calls:** ${toolUsageCell([run])}`,
    '',
    '---',
    '',
    run.answer || '_(no answer)_',
    '',
  ].join('\n');
}

function answerFileName(run: Pick<FixtureRun, 'fixtureId' | 'sample'>, suffix = ''): string {
  return `${run.fixtureId}.s${run.sample}${suffix}.md`;
}

function dryRun(fixtures: AssistantEvalFixture[], invalid: LoadedFixtures['invalid']): number {
  const builder = new PortfolioAssistantPromptBuilder();
  const budget = readPortfolioAssistantConfiguration({}).maxContextCharacters;
  const lines = [
    '| Fixture | Scenario | System | Context | Conversation | ~Tokens | Context budget |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const fixture of fixtures) {
    const prompt = buildPrompt(builder, fixture, fixtureContext(fixture), `assistant-eval-dry-${fixture.id}`);
    const total = prompt.systemChars + prompt.contextChars + prompt.conversationChars;
    const contextJsonChars = JSON.stringify(fixture.context).length;
    lines.push(
      `| ${fixture.id} | ${fixture.scenario} | ${prompt.systemChars} | ${prompt.contextChars} | ${prompt.conversationChars} | ${Math.round(total / 4)} | ${percent(contextJsonChars / budget)} |`,
    );
  }
  process.stdout.write(`${lines.join('\n')}\n\n${fixtures.length} valid fixture(s), ${invalid.length} invalid.\n`);
  for (const item of invalid) process.stdout.write(`\nINVALID ${item.file}:\n${item.error}\n`);
  return invalid.length === 0 ? 0 : 1;
}

interface ReportMeta {
  runId: string;
  model: string;
  mcp: 'eval' | 'live';
  samples: number;
  concurrency: number;
  requestTimeoutMs: number | null;
  toolLogs: string;
  judge: { name: string } | null;
  runs: FixtureRun[];
}

function intervalText(overall: OverallPassRate): string {
  if (overall.interval == null) return 'n/a';
  return `${percent(overall.interval.low)}–${percent(overall.interval.high)}`;
}

function writeReport(outDirectory: string, name: string, meta: ReportMeta): void {
  const checks = summarizeChecks(meta.runs.map((run) => run.grade));
  const fixtures = summarizeFixtureSamples(meta.runs);
  const overall = overallPassRate(meta.runs);
  const majority = fixtures.filter((summary) => summary.majorityPass).length;
  const report = { ...meta, overall, majority: { passed: majority, fixtures: fixtures.length }, fixtures, checks };
  writeFileSync(join(outDirectory, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    `# Assistant eval ${meta.runId}${name === 'report' ? '' : ` (${name})`}`,
    '',
    `Model: ${meta.model}. MCP: ${meta.mcp}. Samples per fixture: ${meta.samples}.`,
    '',
    `Samples passed: ${overall.passed}/${overall.total} (${percent(overall.rate)}, Wilson 95% ${intervalText(overall)}). ` +
      `Fixtures passing by majority: ${majority}/${fixtures.length}.`,
    '',
    '## Checks (all samples)',
    '',
    checkTable(checks),
    '',
    '## Fixtures',
    '',
    fixtureTable(fixtures, meta.runs),
    '',
    '## Samples',
    '',
    sampleTable(meta.runs),
    '',
  ].join('\n');
  writeFileSync(join(outDirectory, `${name}.md`), markdown);
  process.stdout.write(`${markdown}\nWrote ${join(outDirectory, `${name}.md`)}\n`);
}

const SavedReportSchema = z.object({
  runId: z.string(),
  model: z.string(),
  mcp: z.enum(['eval', 'live']).default('live'),
  samples: z.number().int().positive().default(1),
  concurrency: z.number().int().positive().default(1),
  requestTimeoutMs: z.number().nullable(),
  toolLogs: z.string(),
  runs: z.array(
    z.looseObject({
      fixtureId: z.string(),
      sample: z.number().int().positive().default(1),
      answer: z.string(),
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
      tools: z.object({
        observedTools: z.array(z.string()).nullable(),
        evidence: z.string(),
        unattributedCalls: z.number().int().nonnegative().optional(),
      }),
      toolCalls: z
        .array(
          z.object({
            tool: z.string(),
            outcome: z.enum(['ok', 'rejected_input', 'failed', 'timeout']),
            attribution: z.enum(['exact', 'single_active']),
          }),
        )
        .nullable()
        .default(null),
    }),
  ),
});

// Re-grades saved answers against the current fixtures and graders without calling Hermes.
function regrade(runDirectory: string, fixtures: AssistantEvalFixture[]): number {
  const saved = SavedReportSchema.parse(
    JSON.parse(readFileSync(join(runDirectory, 'report.json'), 'utf8')),
  );
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const runs: FixtureRun[] = [];
  for (const run of saved.runs) {
    const fixture = byId.get(run.fixtureId);
    if (fixture == null) continue;
    const tools: AssistantEvalToolObservation = {
      observedTools: run.tools.observedTools,
      evidence: run.tools.evidence,
      ...(run.tools.unattributedCalls != null ? { unattributedCalls: run.tools.unattributedCalls } : {}),
    };
    const grade = gradeAnswer(fixture.expect, run.answer, tools, heldLegs(fixture));
    const regraded: FixtureRun = {
      fixtureId: fixture.id,
      sample: run.sample,
      scenario: fixture.scenario,
      question: fixture.question,
      answer: run.answer,
      error: run.error,
      durationMs: typeof run['durationMs'] === 'number' ? run['durationMs'] : 0,
      usage: null,
      promptChars: { system: 0, context: 0, conversation: 0 },
      tools,
      toolCalls: run.toolCalls,
      grade: run.error == null ? grade : { ...grade, pass: false },
      judge: null,
    };
    writeFileSync(join(runDirectory, 'answers', answerFileName(regraded, '.regraded')), answerMarkdown(regraded));
    runs.push(regraded);
  }
  writeReport(runDirectory, 'report-regraded', {
    runId: saved.runId,
    model: saved.model,
    mcp: saved.mcp,
    samples: saved.samples,
    concurrency: saved.concurrency,
    requestTimeoutMs: saved.requestTimeoutMs,
    toolLogs: saved.toolLogs,
    judge: null,
    runs,
  });
  return 0;
}

// Seam for the optional rubric judge; deterministic grades stay the only gate.
function configuredJudge(): AssistantEvalJudge | null {
  return null;
}

function marketKey(market: SyntheticMarket): string {
  return `${market.params.underlying}:${market.params.spotUsd}:${market.params.nowMs}`;
}

/** Fixtures grouped by the synthetic market their context came from, so one market serves each group. */
function marketGroups(fixtures: AssistantEvalFixture[]): Array<{ market: SyntheticMarket; fixtures: AssistantEvalFixture[] }> {
  const groups = new Map<string, { market: SyntheticMarket; fixtures: AssistantEvalFixture[] }>();
  for (const fixture of fixtures) {
    const market = syntheticMarketForContext(fixture.context);
    const key = marketKey(market);
    const group = groups.get(key) ?? { market, fixtures: [] };
    group.fixtures.push(fixture);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function runPool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

function evalMcpToken(env: NodeJS.ProcessEnv): string {
  const token = env[EVAL_MCP_TOKEN_ENV]?.trim();
  if (!token || token.length < MIN_ASSISTANT_MCP_TOKEN_LENGTH) {
    throw new Error(
      `${EVAL_MCP_TOKEN_ENV} must be set to a random secret of at least ${MIN_ASSISTANT_MCP_TOKEN_LENGTH} characters, ` +
        'the same value as in the portfolio-chat-eval Hermes profile (see EVAL.md).',
    );
  }
  return token;
}

function liveReader(args: EvalArgs, env: NodeJS.ProcessEnv): AssistantMarketDataReader | null {
  const url = args['live-api-url'] ?? `http://127.0.0.1:${env['PORT'] ?? 3100}`;
  if (url === 'none') return null;
  const reader = new AssistantMarketDataReader();
  reader.bind(httpMarketInjector(url));
  return reader;
}

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2));
  const { fixtures, invalid } = loadFixtures(args.fixture);
  if (args['dry-run']) return dryRun(fixtures, invalid);
  if (invalid.length > 0) {
    for (const item of invalid) log.error({ file: item.file, error: item.error }, 'invalid assistant eval fixture');
    return 1;
  }
  if (args.regrade != null) return regrade(args.regrade, fixtures);
  if (args.mcp === 'live' && args.concurrency > 1 && args['tool-logs'] === 'journal') {
    throw new Error('--mcp live reads tool calls from the journal by time window; use --concurrency 1.');
  }

  const configuration = evalConfiguration(process.env, args);
  const gateway = new HermesPortfolioAssistantGateway(configuration);
  if ((await gateway.checkPortfolioAssistantModelAvailability()) !== 'available') {
    log.error({ apiUrl: configuration.apiUrl }, 'Hermes is unreachable; run with --dry-run to validate fixtures only');
    return 1;
  }

  const groups = marketGroups(fixtures);
  let mcp: AssistantEvalMcp | null = null;
  let library: OptionsLibrary | null = null;
  const firstGroup = groups[0];
  if (args.mcp === 'eval' && firstGroup != null) {
    const token = evalMcpToken(process.env);
    const port = args['mcp-port'] ?? Number(process.env[EVAL_MCP_PORT_ENV] ?? EVAL_MCP_DEFAULT_PORT);
    library = new OptionsLibrary(
      resolve(REPO_ROOT, process.env['OPTIONS_LIBRARY_PATH'] ?? 'docs/options-library.sqlite'),
    );
    mcp = new AssistantEvalMcp({
      market: firstGroup.market,
      library,
      live: liveReader(args, process.env),
      log,
    });
    await mcp.listen(token, port);
    log.info({ port }, 'assistant eval MCP server listening on loopback');
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDirectory = join(args.out, runId);
  mkdirSync(join(outDirectory, 'answers'), { recursive: true });
  const environment: RunEnvironment = {
    gateway,
    builder: new PortfolioAssistantPromptBuilder(),
    runId,
    args,
    judge: configuredJudge(),
    mcp,
  };

  const runs: FixtureRun[] = [];
  try {
    for (const group of groups) {
      mcp?.setMarket(group.market);
      const jobs = group.fixtures.flatMap((fixture) =>
        Array.from({ length: args.samples }, (_, index) => ({ fixture, sample: index + 1 })),
      );
      await runPool(jobs, args.concurrency, async ({ fixture, sample }) => {
        log.info({ fixture: fixture.id, sample }, 'assistant eval fixture started');
        const run = await runFixture(environment, fixture, sample);
        writeFileSync(join(outDirectory, 'answers', answerFileName(run)), answerMarkdown(run));
        log.info(
          { fixture: fixture.id, sample, pass: run.grade.pass, durationMs: run.durationMs, error: run.error?.code },
          'assistant eval fixture finished',
        );
        runs.push(run);
      });
    }
  } finally {
    await mcp?.close();
    library?.close();
  }

  const order = new Map(fixtures.map((fixture, index) => [fixture.id, index]));
  runs.sort(
    (left, right) =>
      (order.get(left.fixtureId) ?? 0) - (order.get(right.fixtureId) ?? 0) || left.sample - right.sample,
  );
  writeReport(outDirectory, 'report', {
    runId,
    model: configuration.model,
    mcp: args.mcp,
    samples: args.samples,
    concurrency: args.concurrency,
    requestTimeoutMs: configuration.requestTimeoutMs,
    toolLogs: args.mcp === 'eval' ? 'eval-mcp-registry' : args['tool-logs'],
    judge: environment.judge == null ? null : { name: environment.judge.name },
    runs,
  });
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log.error({ err: error }, 'assistant eval failed');
    process.exitCode = 1;
  });
