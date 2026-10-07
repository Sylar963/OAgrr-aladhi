import { z } from 'zod';

import { ASSISTANT_MCP_TOOL_CALL_MESSAGE } from '../assistant-market/assistant-mcp-server.js';
import { hashPortfolioRef } from '../assistant-market/assistant-run-registry.js';
import type { AssistantEvalToolObservation } from './assistant-eval-checks.js';
import type { EvalRunToolCall, EvalRunToolUsage } from './eval-mcp-server.js';

const ToolCallLineSchema = z.object({
  msg: z.literal(ASSISTANT_MCP_TOOL_CALL_MESSAGE),
  time: z.number(),
  tool: z.string().nullable().optional(),
  // Lines written before per-call outcomes existed were successes only.
  outcome: z.string().default('ok'),
  portfolioRefHash: z.string().optional(),
});

export interface ToolLogWindow {
  startedAt: number;
  until: number;
  portfolioRef: string | null;
}

export interface ToolLogMatch {
  tools: string[];
  matchedByRef: number;
  matchedByWindow: number;
  excludedOtherRuns: number;
}

/**
 * Picks the successful MCP tool calls the eval's request made out of backend log lines. A call
 * carrying the fixture's portfolioRef hash is certainly the eval's; a call carrying any other ref
 * (a product chat run's) is certainly not. Calls without a ref fall back to the time window,
 * which concurrent product users can pollute.
 */
export function matchEvalToolCalls(lines: string, window: ToolLogWindow): ToolLogMatch {
  const fixtureRefHash = window.portfolioRef == null ? null : hashPortfolioRef(window.portfolioRef);
  const match: ToolLogMatch = {
    tools: [],
    matchedByRef: 0,
    matchedByWindow: 0,
    excludedOtherRuns: 0,
  };
  for (const line of lines.split('\n')) {
    if (!line.includes(ASSISTANT_MCP_TOOL_CALL_MESSAGE)) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = ToolCallLineSchema.safeParse(json);
    if (!parsed.success) continue;
    const { time, tool, outcome, portfolioRefHash } = parsed.data;
    if (tool == null || outcome !== 'ok' || time < window.startedAt || time > window.until)
      continue;
    if (portfolioRefHash != null) {
      if (portfolioRefHash !== fixtureRefHash) {
        match.excludedOtherRuns += 1;
        continue;
      }
      match.matchedByRef += 1;
    } else {
      match.matchedByWindow += 1;
    }
    match.tools.push(tool);
  }
  return match;
}

export function registryObservation(usage: EvalRunToolUsage): AssistantEvalToolObservation {
  const { summary, calls } = usage;
  const exact = calls.filter((call) => call.attribution === 'exact').length;
  const notOk = calls.filter((call) => call.outcome !== 'ok').length;
  return {
    observedTools: calls.filter((call) => call.outcome === 'ok').map((call) => call.tool),
    evidence:
      `eval MCP run registry: ${summary.total} call(s), ${exact} attributed by portfolioRef, ` +
      `${summary.total - exact} as the only run in flight; ${notOk} not ok ` +
      `(${summary.rejected} rejected, ${summary.failed} failed, ${summary.timedOut} timed out)` +
      (usage.unattributedDuringRun > 0 ? `; ${usage.unattributedDuringRun} unattributed call(s) overlapped` : ''),
    unattributedCalls: usage.unattributedDuringRun,
  };
}


const SHORT_TOOL_PREFIX = /^oggregator_/;

/** "structure_search ×3 (1 rejected_input)" per tool, over every sample of one fixture. */
export interface ToolUsageRecord {
  tools: AssistantEvalToolObservation;
  // Exact per-call records from the eval MCP server; null when tools came from the journal.
  toolCalls: EvalRunToolCall[] | null;
}

export function toolUsageCell(runs: ToolUsageRecord[]): string {
  if (runs.every((run) => run.toolCalls == null)) {
    const tools = runs.flatMap((run) => run.tools.observedTools ?? []);
    return tools.length === 0 ? '–' : `${[...new Set(tools)].map((tool) => tool.replace(SHORT_TOOL_PREFIX, '')).join(', ')} (journal)`;
  }
  const byTool = new Map<string, { total: number; notOk: Map<string, number> }>();
  for (const call of runs.flatMap((run) => run.toolCalls ?? [])) {
    const entry = byTool.get(call.tool) ?? { total: 0, notOk: new Map<string, number>() };
    entry.total += 1;
    if (call.outcome !== 'ok') entry.notOk.set(call.outcome, (entry.notOk.get(call.outcome) ?? 0) + 1);
    byTool.set(call.tool, entry);
  }
  if (byTool.size === 0) return 'none';
  return [...byTool.entries()]
    .map(([tool, entry]) => {
      const failures = [...entry.notOk.entries()].map(([outcome, count]) => `${count} ${outcome}`).join(', ');
      return `${tool.replace(SHORT_TOOL_PREFIX, '')} ×${entry.total}${failures ? ` (${failures})` : ''}`;
    })
    .join('; ');
}
