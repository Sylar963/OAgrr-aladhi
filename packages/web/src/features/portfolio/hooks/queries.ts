import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { EquityHistoryRange, EquityHistoryVenue, PositionLegInput } from '@oggregator/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addPosition,
  fetchEquityHistory,
  fetchLiveTradingAvailability,
  fetchMetrics,
  fetchThalexKeySlots,
  fetchPositions,
  fetchVenueMargin,
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
  equityHistory: (accountId: string, venue: EquityHistoryVenue, range: EquityHistoryRange) =>
    ['account', accountId, 'portfolio', 'equity-history', venue, range] as const,
  venueMargin: (accountId: string, venue: 'thalex') =>
    ['account', accountId, 'portfolio', 'venue-margin', venue] as const,
  thalexKeys: (accountId: string) => ['account', accountId, 'portfolio', 'thalex-keys'] as const,
  liveTrading: (accountId: string) => ['account', accountId, 'live-trading'] as const,
};

export function useVenueMargin(venue: 'thalex' | null) {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  return useQuery({
    queryKey: PORTFOLIO_QKEY.venueMargin(accountId, venue ?? 'thalex'),
    queryFn: () => fetchVenueMargin(venue ?? 'thalex'),
    enabled: session.status === 'ready' && venue != null,
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useEquityHistory(venue: EquityHistoryVenue, range: EquityHistoryRange) {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  return useQuery({
    queryKey: PORTFOLIO_QKEY.equityHistory(accountId, venue, range),
    queryFn: () => fetchEquityHistory(venue, range),
    enabled: session.status === 'ready',
    staleTime: 5 * 60_000,
    retry: false,
  });
}

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

/** Which Thalex network each stored read-only key belongs to, and which one the portfolio uses. */
export function useThalexKeySlots(enabled = true) {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  return useQuery({
    queryKey: PORTFOLIO_QKEY.thalexKeys(accountId),
    queryFn: fetchThalexKeySlots,
    enabled: session.status === 'ready' && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useLiveTradingAvailability(enabled = true) {
  const session = useAccountSession();
  const accountId = session.accountId ?? 'unresolved';
  return useQuery({
    queryKey: PORTFOLIO_QKEY.liveTrading(accountId),
    queryFn: fetchLiveTradingAvailability,
    enabled: session.status === 'ready' && enabled,
    staleTime: 30_000,
    retry: false,
  });
}
