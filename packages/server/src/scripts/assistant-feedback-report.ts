import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { PostgresPortfolioAssistantFeedbackReportSource } from '@oggregator/db';
import { z } from 'zod';

import { buildFeedbackReport } from '../assistant-eval/assistant-feedback-report.js';
import { readBufferedPortfolioAssistantFeedback } from '../portfolio-assistant-feedback-buffer.js';

// Same WSL2 + Neon workaround as packages/db/src/migrate.ts.
setDefaultResultOrder('ipv4first');

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixturesDirectory = fileURLToPath(new URL('../assistant-eval/fixtures/', import.meta.url));
const defaultOut = fileURLToPath(new URL('../../.eval-out/', import.meta.url));

const ArgsSchema = z.object({
  'since-days': z.coerce.number().int().min(1).max(365).default(30),
  out: z.string().min(1).default(defaultOut),
  cache: z.string().min(1).optional(),
});

function readFixtures(): Array<{ id: string; question: string }> {
  const FixtureSchema = z.object({ id: z.string(), question: z.string() });
  return readdirSync(fixturesDirectory)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      const parsed = FixtureSchema.safeParse(
        JSON.parse(readFileSync(join(fixturesDirectory, file), 'utf8')),
      );
      return parsed.success ? [parsed.data] : [];
    });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'since-days': { type: 'string' },
      out: { type: 'string' },
      cache: { type: 'string' },
    },
  });
  const args = ArgsSchema.parse(values);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const cacheSetting =
    args.cache ??
    process.env['PORTFOLIO_ASSISTANT_FEEDBACK_CACHE_PATH'] ??
    '.cache/portfolio-assistant-feedback.ndjson';
  const cachePath = isAbsolute(cacheSetting) ? cacheSetting : resolve(repoRoot, cacheSetting);
  const log = {
    warn: (obj: object, msg: string) => process.stderr.write(`${msg} ${JSON.stringify(obj)}\n`),
  };

  const generatedAt = new Date();
  const source = PostgresPortfolioAssistantFeedbackReportSource.fromConnectionString(databaseUrl);
  try {
    const report = await buildFeedbackReport({
      source,
      buffered: readBufferedPortfolioAssistantFeedback(cachePath, log),
      since: new Date(generatedAt.getTime() - args['since-days'] * 24 * 60 * 60 * 1_000),
      generatedAt,
      fixtures: readFixtures(),
    });
    const directory = join(args.out, `feedback-${generatedAt.toISOString().slice(0, 10)}`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const reportPath = join(directory, 'report.md');
    writeFileSync(reportPath, report.markdown, { mode: 0o600 });
    writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(report.summary, null, 2)}\n`, {
      mode: 0o600,
    });
    const { totals } = report.summary;
    process.stdout.write(
      `${totals.votes} vote(s): ${totals.up} up, ${totals.down} down, ${report.summary.patterns.length} pattern(s).\nWrote ${reportPath} (private: contains user content)\n`,
    );
  } finally {
    await source.dispose();
  }
}

await main();
