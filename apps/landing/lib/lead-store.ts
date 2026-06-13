import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { LeadInput } from './lead-schema';

// /tmp is the only writable filesystem on Vercel. This keeps the fallback from
// turning the page's only conversion into a 500 — it is best-effort, NOT durable;
// the durable path is the core API via LANDING_API_BASE_URL.
const defaultDataFile = path.join(tmpdir(), 'oggregator-landing', 'landing-leads.jsonl');

function resolveLeadFilePath() {
  const configuredPath = process.env.LANDING_LEADS_FILE;

  if (configuredPath && configuredPath.trim().length > 0) {
    return path.resolve(configuredPath);
  }

  return defaultDataFile;
}

async function appendLeadToFile(input: LeadInput): Promise<void> {
  const filePath = resolveLeadFilePath();

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({
      ...input,
      createdAt: new Date().toISOString(),
    })}\n`,
    'utf8',
  );
}

export async function persistLead(input: LeadInput): Promise<void> {
  const apiBase = process.env.LANDING_API_BASE_URL;

  if (apiBase) {
    try {
      const res = await fetch(`${apiBase}/api/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) return;
    } catch {
      // Network error / timeout — fall through to the best-effort file fallback so a
      // lead has a chance to survive while the core API is unreachable.
    }
  }

  await appendLeadToFile(input);
}
