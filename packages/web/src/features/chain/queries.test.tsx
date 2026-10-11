import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { EnrichedChainResponse } from '@shared/enriched';
import { chainKeys, useChainQuery } from './queries';

function chain(underlying: string, expiry: string): EnrichedChainResponse {
  return {
    underlying,
    expiry,
    expiryTs: null,
    dte: 1,
    stats: {} as EnrichedChainResponse['stats'],
    strikes: [],
    gex: [],
  };
}

function setup(initial: { underlying: string; expiry: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  const hook = renderHook(
    ({ underlying, expiry }) =>
      useChainQuery(underlying, expiry, ['deribit'], { enabled: false, keepPreviousTenor: true }),
    { wrapper, initialProps: initial },
  );
  return { qc, hook };
}

describe('useChainQuery keepPreviousTenor', () => {
  it('keeps the previous tenor as placeholder while disabled, until the new key is written', async () => {
    const { qc, hook } = setup({ underlying: 'BTC', expiry: '2026-12-25' });
    const previous = chain('BTC', '2026-12-25');
    act(() => qc.setQueryData(chainKeys.chain('BTC', '2026-12-25', ['deribit']), previous));
    await waitFor(() => expect(hook.result.current.data).toEqual(previous));

    hook.rerender({ underlying: 'BTC', expiry: '2026-10-12' });
    expect(hook.result.current.isPlaceholderData).toBe(true);
    expect(hook.result.current.data?.expiry).toBe('2026-12-25');

    const next = chain('BTC', '2026-10-12');
    act(() => qc.setQueryData(chainKeys.chain('BTC', '2026-10-12', ['deribit']), next));
    await waitFor(() => expect(hook.result.current.isPlaceholderData).toBe(false));
    expect(hook.result.current.data?.expiry).toBe('2026-10-12');
  });

  it('does not carry a chain across underlyings', async () => {
    const { qc, hook } = setup({ underlying: 'BTC', expiry: '2026-12-25' });
    act(() => qc.setQueryData(chainKeys.chain('BTC', '2026-12-25', ['deribit']), chain('BTC', '2026-12-25')));
    await waitFor(() => expect(hook.result.current.data).toBeDefined());

    hook.rerender({ underlying: 'ETH', expiry: '2026-12-25' });
    expect(hook.result.current.data).toBeUndefined();
    expect(hook.result.current.isPlaceholderData).toBe(false);
  });
});
