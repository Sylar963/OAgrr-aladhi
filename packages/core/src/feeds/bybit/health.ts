import type { VenueConnectionState } from '../../core/types.js';
import type { BybitSystemStatusResponse } from './types.js';

export function deriveBybitHealth(
  status: BybitSystemStatusResponse | null,
  error?: unknown,
  connectionState: VenueConnectionState = 'connected',
): { status: VenueConnectionState; message: string } {
  if (connectionState !== 'connected') {
    return {
      status: connectionState,
      message: `ws ${connectionState}`,
    };
  }

  if (error != null) {
    return {
      status: 'degraded',
      message: `system status probe failed: ${String(error)}`,
    };
  }

  if (status == null || status.retCode !== 0) {
    return {
      status: 'degraded',
      message: 'system status probe failed',
    };
  }

  const active = status.result.list.find(
    (item) => item.state === 'scheduled' || item.state === 'ongoing',
  );
  if (active != null) {
    const title = active.title != null ? `: ${active.title}` : '';
    return {
      status: 'degraded',
      message: `system status ${active.state}${title}`,
    };
  }

  return {
    status: 'connected',
    message: 'system status healthy',
  };
}
