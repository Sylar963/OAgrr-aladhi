import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { PositionLegInput } from '@oggregator/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addPosition,
  fetchMetrics,
  fetchPositions,
  removePosition,
  type PortfolioSource,
} from '../api';

export const PORTFOLIO_QKEY = {
  root: (accountId: string) => ['account', accountId, 'portfolio'] as const,
  positions: (accountId: string, source: PortfolioSource, underlying?: string) =>
    ['account', accountId, 'portfolio', 'positions', source, underlying ?? 'all'] as const,
  metrics: (accountId: string, forwardDays: number, source: PortfolioSource, underlying?: string) =>
    [
      'account',
      accountId,
      'portfolio',
      'metrics',
      forwardDays,
      source,
      underlying ?? 'all',
    ] as const,
};

export function usePortfolioPositions(
  source: PortfolioSource = 'manual',
  options?: { wsLive?: boolean; underlying?: string },
) {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  return useQuery({
    queryKey: PORTFOLIO_QKEY.positions(accountId, source, options?.underlying),
    queryFn: () => fetchPositions(source, options?.underlying),
    enabled: session.status === 'ready',
    refetchInterval: options?.wsLive === true ? false : 5_000,
  });
}

export function usePortfolioMetrics(
  forwardDays: number,
  source: PortfolioSource = 'manual',
  options?: { wsLive?: boolean; underlying?: string },
) {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  return useQuery({
    queryKey: PORTFOLIO_QKEY.metrics(accountId, forwardDays, source, options?.underlying),
    queryFn: () => fetchMetrics(forwardDays, source, options?.underlying),
    enabled: session.status === 'ready',
    refetchInterval: options?.wsLive === true ? false : 5_000,
  });
}

export function useAddPosition() {
  const session = useAccountSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PositionLegInput) => addPosition(input),
    onSuccess: () => {
      if (session.accountId) {
        void queryClient.invalidateQueries({
          queryKey: PORTFOLIO_QKEY.root(session.accountId),
        });
      }
    },
  });
}

export function useRemovePosition() {
  const session = useAccountSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (legId: string) => removePosition(legId),
    onSuccess: () => {
      if (session.accountId) {
        void queryClient.invalidateQueries({
          queryKey: PORTFOLIO_QKEY.root(session.accountId),
        });
      }
    },
  });
}
