/** Exponential backoff with jitter to prevent thundering-herd reconnects. */
export function backoffDelay(attempt: number, baseMs = 500, maxMs = 30_000): number {
  return Math.min(baseMs * 2 ** attempt + Math.random() * 200, maxMs);
}

/**
 * Extra reconnect spacing applied when sessions keep dying young. A session that
 * reconnects, completes resubscribe, then drops again within seconds resets the
 * normal attempt counter every cycle, so its backoff never escalates. Keying off
 * the count of consecutive short-lived sessions instead lets chronic flapping
 * widen the gap between full-resubscribe bursts (which otherwise stack on the
 * event loop and starve the heartbeat). Streak 0 = no penalty.
 */
export function flapBackoffDelay(
  shortSessionStreak: number,
  baseMs = 15_000,
  maxMs = 120_000,
): number {
  if (shortSessionStreak <= 0) return 0;
  return Math.min(baseMs * 2 ** (shortSessionStreak - 1), maxMs);
}

/** Deribit allows ~3.3 subscribe calls/sec (30k credit pool, 3k per call). */
