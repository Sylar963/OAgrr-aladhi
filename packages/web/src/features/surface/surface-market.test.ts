import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSurfaceUnderlying } from './surface-market';

vi.mock('@features/tradfi', () => ({
  useTradfiSelection: () => ({ underlying: 'SPY' }),
}));

describe('surface ticker selection', () => {
  it('keeps comparison instances on their configured ticker across rerenders', () => {
    const { result, rerender } = renderHook(
      ({ underlying }) => useSurfaceUnderlying('crypto', 'BTC', underlying),
      { initialProps: { underlying: 'ETH' } },
    );
    expect(result.current).toEqual({ underlying: 'ETH', setUnderlying: null });
    rerender({ underlying: 'BTC' });
    expect(result.current).toEqual({ underlying: 'BTC', setUnderlying: null });
  });

  it('retains the local picker for an unconfigured standalone panel', () => {
    const { result } = renderHook(() => useSurfaceUnderlying('crypto', 'BTC'));
    act(() => result.current.setUnderlying?.('SOL'));
    expect(result.current.underlying).toBe('SOL');
  });

  it('keeps TradFi panels linked to the TradFi ticker', () => {
    const { result } = renderHook(() => useSurfaceUnderlying('tradfi', 'BTC', 'ETH'));
    expect(result.current).toEqual({ underlying: 'SPY', setUnderlying: null });
  });
});
