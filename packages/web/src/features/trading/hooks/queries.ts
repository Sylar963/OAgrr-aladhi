import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getOrders, getPnl, getPositions, placeOrder } from '../api';

export const QKEY = {
  positions: ['paper', 'positions'] as const,
  pnl: ['paper', 'pnl'] as const,
  orders: ['paper', 'orders'] as const,
};

export function usePositions() {
  return useQuery({
    queryKey: QKEY.positions,
    queryFn: getPositions,
    refetchInterval: 5_000,
  });
}

export function usePnl() {
  return useQuery({
    queryKey: QKEY.pnl,
    queryFn: getPnl,
    refetchInterval: 5_000,
  });
}

export function useOrders(limit = 50) {
  return useQuery({
    queryKey: [...QKEY.orders, limit],
    queryFn: () => getOrders(limit),
    refetchInterval: 10_000,
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: placeOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QKEY.positions });
      qc.invalidateQueries({ queryKey: QKEY.pnl });
      qc.invalidateQueries({ queryKey: QKEY.orders });
    },
  });
}
