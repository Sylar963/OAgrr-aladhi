import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFundedRun,
  getFundedRuns,
  getFundedTemplates,
  startFundedRun,
  withdrawFundedRun,
} from '../api';

export const FUNDED_QKEY = {
  templates: ['funded', 'templates'] as const,
  runs: ['funded', 'runs'] as const,
  run: ['funded', 'run'] as const,
};

export function useFundedTemplates() {
  return useQuery({ queryKey: FUNDED_QKEY.templates, queryFn: getFundedTemplates });
}

export function useFundedRuns() {
  return useQuery({
    queryKey: FUNDED_QKEY.runs,
    queryFn: getFundedRuns,
    refetchInterval: 15_000,
  });
}

export function useFundedRun(id: string | null) {
  return useQuery({
    queryKey: [...FUNDED_QKEY.run, id],
    queryFn: () => getFundedRun(id!),
    enabled: id != null,
    refetchInterval: 15_000,
  });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startFundedRun,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FUNDED_QKEY.runs });
    },
  });
}

export function useWithdrawRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: withdrawFundedRun,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: FUNDED_QKEY.runs });
      void qc.invalidateQueries({ queryKey: FUNDED_QKEY.run });
    },
  });
}
