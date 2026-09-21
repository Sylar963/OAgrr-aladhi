import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addTradeNote,
  closeTrade,
  createTrade,
  getActivity,
  getFills,
  getOrders,
  getPaperAccount,
  getOverview,
  getPnl,
  getPositions,
  getTrade,
  getTrades,
  initPaperAccount,
  placeOrder,
  reduceTrade,
} from '../api';

export const QKEY = {
  root: (accountId: string) => ['account', accountId, 'paper'] as const,
  account: (accountId: string) => ['account', accountId, 'paper', 'account'] as const,
  positions: (accountId: string) => ['account', accountId, 'paper', 'positions'] as const,
  pnl: (accountId: string) => ['account', accountId, 'paper', 'pnl'] as const,
  orders: (accountId: string) => ['account', accountId, 'paper', 'orders'] as const,
  overview: (accountId: string) => ['account', accountId, 'paper', 'overview'] as const,
  trades: (accountId: string) => ['account', accountId, 'paper', 'trades'] as const,
  trade: (accountId: string) => ['account', accountId, 'paper', 'trade'] as const,
  activity: (accountId: string) => ['account', accountId, 'paper', 'activity'] as const,
  fills: (accountId: string) => ['account', accountId, 'paper', 'fills'] as const,
};

function usePaperSession() {
  const session = useAccountSession();
  return {
    accountId: session.accountId ?? 'unresolved',
    enabled: session.status === 'ready',
  };
}

function invalidatePaper(queryClient: ReturnType<typeof useQueryClient>, accountId: string) {
  void queryClient.invalidateQueries({ queryKey: QKEY.root(accountId) });
}

export function usePositions() {
  const session = usePaperSession();
  return useQuery({
    queryKey: QKEY.positions(session.accountId),
    queryFn: getPositions,
    enabled: session.enabled,
  });
}

export function usePaperAccount() {
  const session = usePaperSession();
  return useQuery({
    queryKey: QKEY.account(session.accountId),
    queryFn: getPaperAccount,
    enabled: session.enabled,
  });
}

export function usePnl() {
  const session = usePaperSession();
  return useQuery({
    queryKey: QKEY.pnl(session.accountId),
    queryFn: getPnl,
    enabled: session.enabled,
  });
}

export function useOrders(limit = 50) {
  const session = usePaperSession();
  return useQuery({
    queryKey: [...QKEY.orders(session.accountId), limit],
    queryFn: () => getOrders(limit),
    enabled: session.enabled,
  });
}

export function useOverview() {
  const session = usePaperSession();
  return useQuery({
    queryKey: QKEY.overview(session.accountId),
    queryFn: getOverview,
    enabled: session.enabled,
  });
}

export function useTrades(status: 'open' | 'closed' | 'all' = 'all', limit = 100) {
  const session = usePaperSession();
  return useQuery({
    queryKey: [...QKEY.trades(session.accountId), status, limit],
    queryFn: () => getTrades(status, limit),
    enabled: session.enabled,
  });
}

export function useTrade(tradeId: string | null) {
  const session = usePaperSession();
  return useQuery({
    queryKey: [...QKEY.trade(session.accountId), tradeId],
    queryFn: () => getTrade(tradeId!),
    enabled: session.enabled && tradeId != null,
  });
}

export function useActivity(limit = 100, tradeId?: string) {
  const session = usePaperSession();
  return useQuery({
    queryKey: [...QKEY.activity(session.accountId), limit, tradeId ?? 'all'],
    queryFn: () => getActivity(limit, tradeId),
    enabled: session.enabled,
  });
}

export function useFills(limit = 100, tradeId?: string) {
  const session = usePaperSession();
  return useQuery({
    queryKey: [...QKEY.fills(session.accountId), limit, tradeId ?? 'all'],
    queryFn: () => getFills(limit, tradeId),
    enabled: session.enabled,
  });
}

export function usePlaceOrder() {
  const session = usePaperSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: placeOrder,
    onSuccess: () => invalidatePaper(queryClient, session.accountId),
  });
}

export function useCreateTrade() {
  const session = usePaperSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTrade,
    onSuccess: (result) => {
      queryClient.setQueryData([...QKEY.trade(session.accountId), result.trade.id], result.trade);
      invalidatePaper(queryClient, session.accountId);
    },
  });
}

export function useAddTradeNote() {
  const session = usePaperSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tradeId,
      content,
    }: {
      tradeId: string;
      content: Parameters<typeof addTradeNote>[1];
    }) => addTradeNote(tradeId, content),
    onSuccess: (trade) => {
      queryClient.setQueryData([...QKEY.trade(session.accountId), trade.id], trade);
      invalidatePaper(queryClient, session.accountId);
    },
  });
}

export function useCloseTrade() {
  const session = usePaperSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: closeTrade,
    onSuccess: (trade) => {
      queryClient.setQueryData([...QKEY.trade(session.accountId), trade.id], trade);
      invalidatePaper(queryClient, session.accountId);
    },
  });
}

export function useReduceTrade() {
  const session = usePaperSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, fraction }: { tradeId: string; fraction: number }) =>
      reduceTrade(tradeId, fraction),
    onSuccess: (trade) => {
      queryClient.setQueryData([...QKEY.trade(session.accountId), trade.id], trade);
      invalidatePaper(queryClient, session.accountId);
    },
  });
}

export function useInitPaperAccount() {
  const session = usePaperSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: initPaperAccount,
    onSuccess: (account) => {
      queryClient.setQueryData(QKEY.account(session.accountId), account);
      invalidatePaper(queryClient, session.accountId);
    },
  });
}
