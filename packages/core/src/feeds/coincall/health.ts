export function deriveCoincallHealth(
  serverTime: number | null,
  config: { optionConfig?: Record<string, unknown> } | null,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  if (error != null) {
    return {
      status: 'degraded',
      message: `rest probe failed: ${String(error)}`,
    };
  }

  const hasConfig = config != null && config.optionConfig != null;

  if (serverTime != null && hasConfig) {
    return {
      status: 'connected',
      message: 'rest health ok',
    };
  }

  return {
    status: 'degraded',
    message: 'rest health incomplete',
  };
}
