export interface AssistantTokenRates {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface AssistantTokenUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}

export function readAssistantTokenRates(env: NodeJS.ProcessEnv): AssistantTokenRates | null {
  const names = ['HERMES_INPUT_USD_PER_MILLION', 'HERMES_CACHED_INPUT_USD_PER_MILLION', 'HERMES_OUTPUT_USD_PER_MILLION'] as const;
  if (names.every((name) => !env[name]?.trim())) return null;
  const values = names.map((name) => {
    const raw = env[name]?.trim();
    const value = raw ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a nonnegative rate when token pricing is configured`);
    return value;
  });
  return { inputUsdPerMillion: values[0]!, cachedInputUsdPerMillion: values[1]!, outputUsdPerMillion: values[2]! };
}

export function estimateAssistantCost(usage: AssistantTokenUsage | null, rates: AssistantTokenRates | null | undefined): number | null {
  if (!rates || !usage || usage.inputTokens == null || usage.outputTokens == null || usage.cachedInputTokens == null) return null;
  const { inputTokens, cachedInputTokens, outputTokens } = usage;
  if ([inputTokens, cachedInputTokens, outputTokens].some((value) => !Number.isFinite(value) || value < 0) || cachedInputTokens > inputTokens) return null;
  return ((inputTokens - cachedInputTokens) * rates.inputUsdPerMillion + cachedInputTokens * rates.cachedInputUsdPerMillion + outputTokens * rates.outputUsdPerMillion) / 1_000_000;
}
