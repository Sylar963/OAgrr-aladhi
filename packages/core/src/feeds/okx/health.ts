import type { VenueConnectionState } from '../../core/types.js';
import type { OkxWsNotice, OkxWsStatusMsg } from './types.js';

export function deriveOkxNoticeHealth(notice: OkxWsNotice): {
  status: 'reconnecting';
  message: string;
} {
  const code = notice.code != null ? ` (${notice.code})` : '';
  return {
    status: 'reconnecting',
    message: `${notice.msg ?? 'service notice'}${code}`,
  };
}

export function deriveOkxStatusHealth(message: OkxWsStatusMsg): {
  status: VenueConnectionState;
  message: string;
} {
  return deriveOkxStatusHealthForConnection(message, 'connected');
}

export function deriveOkxStatusHealthForConnection(
  message: OkxWsStatusMsg,
  connectionState: VenueConnectionState,
): {
  status: VenueConnectionState;
  message: string;
} {
  if (connectionState !== 'connected') {
    return {
      status: connectionState,
      message: `ws ${connectionState}`,
    };
  }

  const active = message.data.find(
    (item) => item.state === 'scheduled' || item.state === 'ongoing' || item.state === 'pre_open',
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
