import { z } from 'zod';

import { ASSISTANT_MCP_TOOL_CALL_MESSAGE } from '../assistant-market/assistant-mcp-server.js';
import { hashPortfolioRef } from '../assistant-market/assistant-run-registry.js';

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
