import { useAccountSession } from '@components/auth/AccountSessionProvider';
import type { LeaderboardPeriod, UpdateSocialProfileRequest } from '@oggregator/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getLeaderboard, getSocialProfile, getThesisFeed, updateSocialProfile } from '../api';

const LEADERBOARD_REFRESH_MS = 5 * 60_000;
const THESIS_FEED_REFRESH_MS = 60_000;

export const SOCIAL_QKEY = {
  root: (userId: string) => ['account', userId, 'social'] as const,
  profile: (userId: string) => ['account', userId, 'social', 'profile'] as const,
  leaderboard: (userId: string, period: LeaderboardPeriod) =>
    ['account', userId, 'social', 'leaderboard', period] as const,
  theses: (userId: string) => ['account', userId, 'social', 'theses'] as const,
};

function useSocialSession() {
  const session = useAccountSession();
  return { userId: session.userId ?? 'unresolved', enabled: session.status === 'ready' };
}

export function useSocialProfile() {
  const session = useSocialSession();
  return useQuery({
    queryKey: SOCIAL_QKEY.profile(session.userId),
    queryFn: getSocialProfile,
    enabled: session.enabled,
    staleTime: Infinity,
  });
}

export function useUpdateSocialProfile() {
  const session = useSocialSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: UpdateSocialProfileRequest) => updateSocialProfile(request),
    onSuccess: (profile) => {
      queryClient.setQueryData(SOCIAL_QKEY.profile(session.userId), profile);
      void queryClient.invalidateQueries({ queryKey: SOCIAL_QKEY.root(session.userId) });
    },
  });
}

export function useLeaderboard(period: LeaderboardPeriod) {
  const session = useSocialSession();
  return useQuery({
    queryKey: SOCIAL_QKEY.leaderboard(session.userId, period),
    queryFn: () => getLeaderboard(period),
    enabled: session.enabled,
    staleTime: LEADERBOARD_REFRESH_MS,
    refetchInterval: LEADERBOARD_REFRESH_MS,
  });
}

export function useThesisFeed() {
  const session = useSocialSession();
  return useQuery({
    queryKey: SOCIAL_QKEY.theses(session.userId),
    queryFn: getThesisFeed,
    enabled: session.enabled,
    staleTime: 30_000,
    refetchInterval: THESIS_FEED_REFRESH_MS,
  });
}

export function useThesisFeedRefresh() {
  const session = useSocialSession();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SOCIAL_QKEY.theses(session.userId) });
}
