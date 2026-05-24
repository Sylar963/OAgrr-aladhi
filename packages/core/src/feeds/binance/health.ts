import type { VenueConnectionState } from '../../core/types.js';
import type { BinanceHealthExchangeInfo } from './types.js';

export function deriveBinanceHealth(
  serverTime: number | null,
  exchangeInfo: BinanceHealthExchangeInfo | null,
  error?: unknown,
): { status: 'connected' | 'degraded'; message: string } {
  const health = deriveBinanceHealthForConnection(serverTime, exchangeInfo, 'connected', error);
  return {
    status: health.status === 'connected' ? 'connected' : 'degraded',
    message: health.message,
  };
}

export function deriveBinanceHealthForConnection(
  serverTime: number | null,
  exchangeInfo: BinanceHealthExchangeInfo | null,
  connectionState: VenueConnectionState,
  error?: unknown,
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
      message: `rest probe failed: ${String(error)}`,
    };
  }

  const hasSymbols =
    exchangeInfo != null &&
    (Array.isArray(exchangeInfo.optionSymbols) || Array.isArray(exchangeInfo.symbols));

  if (serverTime != null && hasSymbols) {
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
