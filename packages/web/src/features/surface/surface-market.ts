import { useTradfiSelection } from '@features/tradfi';
import { useState } from 'react';

export type SurfaceMarket = 'crypto' | 'tradfi';

export const TRADFI_SURFACE_VENUES = ['tastytrade'];

/** Crypto panels pick their own underlying; TradFi panels follow the TradFi header ticker. */
export function useSurfaceUnderlying(market: SurfaceMarket, defaultUnderlying: string) {
  const [local, setLocal] = useState(defaultUnderlying);
  const tradfi = useTradfiSelection(market === 'tradfi');
  return market === 'tradfi'
    ? { underlying: tradfi.underlying, setUnderlying: null }
    : { underlying: local, setUnderlying: setLocal };
}
