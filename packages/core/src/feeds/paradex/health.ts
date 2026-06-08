export interface ParadexHealthProbe {
  serverTime: number | null;
  wsConnected: boolean;
  error?: unknown;
}

export function deriveParadexHealth(probe: ParadexHealthProbe): {
  status: 'connected' | 'degraded';
  message: string;
} {
  if (probe.error != null) return { status: 'degraded', message: `health probe failed: ${String(probe.error)}` };
  if (probe.serverTime == null) return { status: 'degraded', message: 'time probe failed' };
  if (!probe.wsConnected) return { status: 'degraded', message: 'ws disconnected' };
  return { status: 'connected', message: 'healthy' };
}
