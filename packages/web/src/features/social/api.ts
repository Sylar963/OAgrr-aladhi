import { getClerkToken } from '@lib/clerk-token';
import { fetchJson } from '@lib/http';
import {
  type LeaderboardPeriod,
  type LeaderboardResponse,
  LeaderboardResponseSchema,
  type PublicThesisFeed,
  PublicThesisFeedSchema,
  type SocialProfileDto,
  SocialProfileDtoSchema,
  type UpdateSocialProfileRequest,
} from '@oggregator/protocol';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export async function getSocialProfile(): Promise<SocialProfileDto> {
  return SocialProfileDtoSchema.parse(await fetchJson<unknown>('/social/profile'));
}

export async function updateSocialProfile(
  request: UpdateSocialProfileRequest,
): Promise<SocialProfileDto> {
  const token = await getClerkToken();
  const res = await fetch(`${API_BASE}/social/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(request),
  });
  const payload: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return SocialProfileDtoSchema.parse(payload);
}

export async function getLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardResponse> {
  return LeaderboardResponseSchema.parse(
    await fetchJson<unknown>(`/social/leaderboard?period=${period}`),
  );
}

export async function getThesisFeed(): Promise<PublicThesisFeed> {
  return PublicThesisFeedSchema.parse(await fetchJson<unknown>('/social/theses'));
}
