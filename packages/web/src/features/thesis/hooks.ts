import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { ThesisGateLeg, ThesisView } from '@oggregator/protocol';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { checkThesisGate, fetchTheses } from './api';

const LIST_REFRESH_MS = 60_000;
const GATE_DEBOUNCE_MS = 750;

export const thesisQueryKey = (accountId: string | null) => ['account', accountId ?? 'none', 'thesis'] as const;

export function useTheses() {
  const session = useAccountSession();
  return useQuery({
    queryKey: thesisQueryKey(session.accountId),
    queryFn: fetchTheses,
    enabled: session.status === 'ready',
    refetchInterval: LIST_REFRESH_MS,
    staleTime: 15_000,
  });
}

export interface UnderlyingThesis {
  active: ThesisView | null;
  reversal: ThesisView | null;
}

export function useThesisFor(underlying: string): UnderlyingThesis & { ready: boolean } {
  const { data, isSuccess } = useTheses();
  return useMemo(
    () => ({
      ready: isSuccess,
      active: data?.active.find((view) => view.thesis.underlying === underlying) ?? null,
      reversal: data?.reversalCooldowns.find((view) => view.thesis.underlying === underlying) ?? null,
    }),
    [data, isSuccess, underlying],
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Leg identity without live premium/IV, so price ticks don't create a new gate query. */
export function gateStructureKey(legs: ThesisGateLeg[] | null): string | null {
  if (legs == null || legs.length === 0) return null;
  return JSON.stringify(legs.map(({ expiry, strike, optionRight, side, size }) => [expiry, strike, optionRight, side, size]));
}

export function useThesisGate(underlying: string, legs: ThesisGateLeg[] | null) {
  const session = useAccountSession();
  const debouncedKey = useDebounced(gateStructureKey(legs), GATE_DEBOUNCE_MS);
  const latestLegs = useRef(legs);
  latestLegs.current = legs;
  return useQuery({
    queryKey: [...thesisQueryKey(session.accountId), 'gate', underlying, debouncedKey],
    queryFn: () => checkThesisGate({ underlying, legs: latestLegs.current ?? [] }),
    enabled: session.status === 'ready' && debouncedKey != null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Runs a thesis write and refreshes every thesis query, the gate included. */
export function useThesisRefresh() {
  const session = useAccountSession();
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: thesisQueryKey(session.accountId) }),
    [queryClient, session.accountId],
  );
}
