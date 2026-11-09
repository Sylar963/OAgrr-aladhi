import { useTradfiSelection } from '@features/tradfi';
import { useState } from 'react';

export type SurfaceMarket = 'crypto' | 'tradfi';

export const TRADFI_SURFACE_VENUES = ['tastytrade'];

export function useSurfaceUnderlying(
  market: SurfaceMarket,
  defaultUnderlying: string,
  underlying?: string,
) {
  const [local, setLocal] = useState(defaultUnderlying);
  const tradfi = useTradfiSelection(market === 'tradfi');
  return market === 'tradfi'
    ? { underlying: tradfi.underlying, setUnderlying: null }
    : { underlying: underlying ?? local, setUnderlying: underlying ? null : setLocal };
}
