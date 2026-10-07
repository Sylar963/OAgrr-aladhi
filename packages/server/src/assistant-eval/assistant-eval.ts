import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { logger } from '@oggregator/core';
import { z } from 'zod';

import { HermesPortfolioAssistantGateway } from '../hermes-portfolio-assistant-gateway.js';
import {
  type PortfolioAssistantConfiguration,
  readPortfolioAssistantConfiguration,
} from '../portfolio-assistant-configuration.js';
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
import { matchEvalToolCalls } from './assistant-eval-tool-log.js';

const log = logger.child({ component: 'assistant-eval' });
const execFileAsync = promisify(execFile);

const FIXTURE_DIRECTORY = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DEFAULT_OUT_DIRECTORY = fileURLToPath(new URL('../../.eval-out/', import.meta.url));
const TOOL_LOG_SETTLE_MS = 1_500;

const ArgsSchema = z.object({
  fixture: z.array(z.string().min(1)).default([]),
  'dry-run': z.boolean().default(false),
  out: z.string().min(1).default(DEFAULT_OUT_DIRECTORY),
  'timeout-ms': z.coerce.number().int().positive().optional(),
  'tool-logs': z.enum(['journal', 'none']).default('journal'),
  'journal-unit': z.string().min(1).default('ogg-backend.service'),
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
  scenario: AssistantEvalFixture['scenario'];
  question: string;
  answer: string;
  error: { code: string; message: string } | null;
  durationMs: number;
  usage: { inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null } | null;
  promptChars: { system: number; context: number; conversation: number };
  tools: AssistantEvalToolObservation;
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
      'tool-logs': { type: 'string' },
      'journal-unit': { type: 'string' },
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
  threadId: string,
): PromptParts {
  const systemInstructions = builder.buildPortfolioAssistantSystemInstructions();
  const contextMessage = builder.buildPortfolioAssistantContextMessage(fixtureContext(fixture));
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

function evalConfiguration(env: NodeJS.ProcessEnv, timeoutMs: number | undefined): PortfolioAssistantConfiguration {
  // The eval must run while the product flag is off, so the enabled-only checks are applied here.
  const base = readPortfolioAssistantConfiguration({ ...env, PORTFOLIO_ASSISTANT_ENABLED: 'false' });
  if (!base.apiKey) throw new Error('HERMES_PORTFOLIO_API_KEY is not set (checked process env and ../../.env).');
  try {
    new URL(base.apiUrl);
  } catch {
    throw new Error('HERMES_PORTFOLIO_API_URL must be an absolute URL.');
  }
  return { ...base, enabled: true, requestTimeoutMs: timeoutMs ?? base.requestTimeoutMs };
}

async function observeTools(
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

async function runFixture(
  gateway: HermesPortfolioAssistantGateway,
  builder: PortfolioAssistantPromptBuilder,
  fixture: AssistantEvalFixture,
  runId: string,
  args: EvalArgs,
  judge: AssistantEvalJudge | null,
): Promise<FixtureRun> {
  const prompt = buildPrompt(builder, fixture, `assistant-eval-${runId}-${fixture.id}`);
  const startedAt = Date.now();
  let answer = '';
  let usage: FixtureRun['usage'] = null;
  let error: FixtureRun['error'] = null;
  try {
    for await (const event of gateway.streamPortfolioAnswer(prompt.request, new AbortController().signal)) {
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
  const tools = await observeTools(args, fixture.context.portfolioRef, startedAt, finishedAt);
  const grade = gradeAnswer(fixture.expect, answer, tools, heldLegs(fixture));
  const judged =
    judge == null || answer === ''
      ? null
      : { name: judge.name, ...(await judge.score({ fixtureId: fixture.id, question: fixture.question, answer })) };
  return {
    fixtureId: fixture.id,
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

function fixtureTable(runs: FixtureRun[]): string {
  return [
    '| Fixture | Result | Failed checks | Chars | Seconds |',
    '| --- | --- | --- | --- | --- |',
    ...runs.map((run) => {
      const failed: string[] = run.grade.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.check);
      if (run.error) failed.unshift(`error:${run.error.code}`);
      return `| ${run.fixtureId} | ${run.grade.pass ? 'pass' : 'FAIL'} | ${failed.join(', ') || '-'} | ${run.answer.length} | ${(run.durationMs / 1000).toFixed(1)} |`;
    }),
  ].join('\n');
}

function answerMarkdown(run: FixtureRun): string {
  return [
    `# ${run.fixtureId}`,
    '',
    `**Question:** ${run.question}`,
    '',
    `**Result:** ${run.grade.pass ? 'pass' : 'FAIL'}${run.error ? ` (error ${run.error.code}: ${run.error.message})` : ''}`,
    '',
    ...run.grade.checks.map((check) => `- ${check.check}: ${check.status} — ${check.detail}`),
    '',
    '---',
    '',
    run.answer || '_(no answer)_',
    '',
  ].join('\n');
}

function dryRun(fixtures: AssistantEvalFixture[], invalid: LoadedFixtures['invalid']): number {
  const builder = new PortfolioAssistantPromptBuilder();
  const budget = readPortfolioAssistantConfiguration({}).maxContextCharacters;
  const lines = [
    '| Fixture | Scenario | System | Context | Conversation | ~Tokens | Context budget |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const fixture of fixtures) {
    const prompt = buildPrompt(builder, fixture, `assistant-eval-dry-${fixture.id}`);
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
  requestTimeoutMs: number | null;
  toolLogs: string;
  judge: { name: string } | null;
  runs: FixtureRun[];
}

function writeReport(outDirectory: string, name: string, meta: ReportMeta): void {
  const summary = summarizeChecks(meta.runs.map((run) => run.grade));
  const passed = meta.runs.filter((run) => run.grade.pass).length;
  const report = { ...meta, fixtures: meta.runs.length, passed, checks: summary };
  writeFileSync(join(outDirectory, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    `# Assistant eval ${meta.runId}${name === 'report' ? '' : ` (${name})`}`,
    '',
    `Model: ${meta.model}. Fixtures passed: ${passed}/${meta.runs.length}.`,
    '',
    '## Checks',
    '',
    checkTable(summary),
    '',
    '## Fixtures',
    '',
    fixtureTable(meta.runs),
    '',
  ].join('\n');
  writeFileSync(join(outDirectory, `${name}.md`), markdown);
  process.stdout.write(`${markdown}\nWrote ${join(outDirectory, `${name}.md`)}\n`);
}

const SavedReportSchema = z.object({
  runId: z.string(),
  model: z.string(),
  requestTimeoutMs: z.number().nullable(),
  toolLogs: z.string(),
  runs: z.array(
    z.looseObject({
      fixtureId: z.string(),
      answer: z.string(),
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
      tools: z.object({ observedTools: z.array(z.string()).nullable(), evidence: z.string() }),
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
    const grade = gradeAnswer(fixture.expect, run.answer, run.tools, heldLegs(fixture));
    const regraded: FixtureRun = {
      fixtureId: fixture.id,
      scenario: fixture.scenario,
      question: fixture.question,
      answer: run.answer,
      error: run.error,
      durationMs: typeof run['durationMs'] === 'number' ? run['durationMs'] : 0,
      usage: null,
      promptChars: { system: 0, context: 0, conversation: 0 },
      tools: run.tools,
      grade: run.error == null ? grade : { ...grade, pass: false },
      judge: null,
    };
    writeFileSync(join(runDirectory, 'answers', `${fixture.id}.regraded.md`), answerMarkdown(regraded));
    runs.push(regraded);
  }
  writeReport(runDirectory, 'report-regraded', {
    runId: saved.runId,
    model: saved.model,
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

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2));
  const { fixtures, invalid } = loadFixtures(args.fixture);
  if (args['dry-run']) return dryRun(fixtures, invalid);
  if (invalid.length > 0) {
    for (const item of invalid) log.error({ file: item.file, error: item.error }, 'invalid assistant eval fixture');
    return 1;
  }
  if (args.regrade != null) return regrade(args.regrade, fixtures);

  const configuration = evalConfiguration(process.env, args['timeout-ms']);
  const gateway = new HermesPortfolioAssistantGateway(configuration);
  if ((await gateway.checkPortfolioAssistantModelAvailability()) !== 'available') {
    log.error({ model: configuration.model }, 'Hermes is unreachable; run with --dry-run to validate fixtures only');
    return 1;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDirectory = join(args.out, runId);
  mkdirSync(join(outDirectory, 'answers'), { recursive: true });
  const builder = new PortfolioAssistantPromptBuilder();
  const judge = configuredJudge();

  const runs: FixtureRun[] = [];
  for (const fixture of fixtures) {
    log.info({ fixture: fixture.id }, 'assistant eval fixture started');
    const run = await runFixture(gateway, builder, fixture, runId, args, judge);
    writeFileSync(join(outDirectory, 'answers', `${fixture.id}.md`), answerMarkdown(run));
    log.info(
      { fixture: fixture.id, pass: run.grade.pass, durationMs: run.durationMs, error: run.error?.code },
      'assistant eval fixture finished',
    );
    runs.push(run);
  }

  writeReport(outDirectory, 'report', {
    runId,
    model: configuration.model,
    requestTimeoutMs: configuration.requestTimeoutMs,
    toolLogs: args['tool-logs'],
    judge: judge == null ? null : { name: judge.name },
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
