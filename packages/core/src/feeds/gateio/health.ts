import type { VenueConnectionState } from '../../core/types.js';

export interface GateioWsError {
  code?: number;
  message?: string;
  at: number;
}

export interface GateioHealthInput {
  restOk: boolean;
  restLatencyMs: number;
  lastWsError: GateioWsError | null;
  lastUpdateAt: number;
  trackedContracts: number;
}

export interface GateioHealth {
  state: VenueConnectionState;
  reason?: string;
}

const ERROR_GRACE_MS = 30_000;
const QUOTE_STALE_AFTER_MS = 2 * 60_000;

export function deriveGateioHealth(input: GateioHealthInput): GateioHealth {
  if (!input.restOk) {
    return { state: 'down', reason: 'rest-probe-failed' };
  }
  if (input.lastWsError && Date.now() - input.lastWsError.at < ERROR_GRACE_MS) {
    return {
      state: 'degraded',
      reason: `ws-error:${input.lastWsError.code ?? '?'}:${input.lastWsError.message ?? 'unknown'}`,
    };
  }
  if (input.trackedContracts > 0 && input.lastUpdateAt > 0) {
    const staleMs = Date.now() - input.lastUpdateAt;
    if (staleMs >= QUOTE_STALE_AFTER_MS) {
      return { state: 'degraded', reason: `ws-stale:${Math.round(staleMs / 1000)}s` };
    }
  }
  return { state: 'connected' };
}
