import { z } from 'zod';

export const TOOL_ERROR_CODES = [
  'invalid_params',
  'unknown_tool',
  'invalid_arguments',
  'portfolio_ref_required',
  'portfolio_ref_unresolved',
  'not_found',
  'no_quote',
  'no_spot',
  'unavailable',
  'upstream_unavailable',
  'upstream_error',
  'timeout',
  'internal_error',
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

/**
 * Body of every tool result that is not data. Recoverable conditions travel as a normal result
 * (no `isError`) so the MCP client's circuit breaker does not count them; only `internal_error`
 * is flagged as an error result.
 */
export const ToolErrorPayloadSchema = z.object({
  ok: z.literal(false),
  code: z.enum(TOOL_ERROR_CODES),
  error: z.string(),
  hint: z.string(),
  retryable: z.boolean(),
});
export type ToolErrorPayload = z.infer<typeof ToolErrorPayloadSchema>;

const ANSWER_WITHOUT = 'otherwise answer from the portfolio context and name the missing data.';

const DEFAULTS: Record<ToolErrorCode, { hint: string; retryable: boolean }> = {
  invalid_params: {
    hint: 'Send tools/call params as { name, arguments }. Fix the call once; do not repeat it unchanged.',
    retryable: true,
  },
  unknown_tool: { hint: 'Use a tool name from tools/list. Do not repeat this call.', retryable: false },
  invalid_arguments: {
    hint: 'Fix the arguments named in error to match the tool input schema and call once more. Do not repeat an identical call.',
    retryable: true,
  },
  portfolio_ref_required: {
    hint: 'Pass portfolioRef exactly as given in the latest portfolio context. If it is missing, use another view or answer from riskBudgetFacts.',
    retryable: true,
  },
  portfolio_ref_unresolved: {
    hint: 'The book could not be loaded with this portfolioRef. Do not retry with the same ref; answer from riskBudgetFacts and the portfolio context, and say book-wide tool numbers were unavailable.',
    retryable: false,
  },
  not_found: {
    hint: 'Check listed expiries with oggregator_list_expiries or strikes with oggregator_option_chain, then call once with a listed value.',
    retryable: true,
  },
  no_quote: {
    hint: 'Pick strikes with two-sided quotes from oggregator_option_chain, or drop the venue filter, and call once more. Never substitute a price.',
    retryable: true,
  },
  no_spot: { hint: `Retry at most once; ${ANSWER_WITHOUT}`, retryable: true },
  unavailable: { hint: `This data is not available here. Do not retry; ${ANSWER_WITHOUT}`, retryable: false },
  upstream_unavailable: {
    hint: `Market data is loading or temporarily unavailable. Retry at most once; ${ANSWER_WITHOUT}`,
    retryable: true,
  },
  upstream_error: { hint: `Retry at most once; ${ANSWER_WITHOUT}`, retryable: true },
  timeout: {
    hint: `The read timed out. Retry at most once with a narrower request; ${ANSWER_WITHOUT}`,
    retryable: true,
  },
  internal_error: {
    hint: `The tool failed. Do not retry this call; ${ANSWER_WITHOUT}`,
    retryable: false,
  },
};

export function toolErrorPayload(code: ToolErrorCode, error: string, hint?: string): ToolErrorPayload {
  const defaults = DEFAULTS[code];
  return { ok: false, code, error, hint: hint ?? defaults.hint, retryable: defaults.retryable };
}

export function codeForHttpStatus(statusCode: number): ToolErrorCode {
  if (statusCode === 400 || statusCode === 422) return 'invalid_arguments';
  if (statusCode === 404) return 'not_found';
  if (statusCode === 503) return 'upstream_unavailable';
  return 'upstream_error';
}
