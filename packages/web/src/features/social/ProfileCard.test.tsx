import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openUserProfile = vi.fn();
const api = {
  profile: { handle: null as string | null, leaderboardVisible: false, consentedAt: null },
};

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ openUserProfile }),
  useUser: () => ({ user: { username: api.profile.handle } }),
}));

vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', userId: 'user_1', accountId: 'acct_1' }),
}));

const updateSocialProfile = vi.fn(async (req: { leaderboardVisible: boolean }) => {
  api.profile = { ...api.profile, leaderboardVisible: req.leaderboardVisible };
  return api.profile;
});

vi.mock('./api', () => ({
  getSocialProfile: vi.fn(async () => api.profile),
  updateSocialProfile: (req: { leaderboardVisible: boolean }) => updateSocialProfile(req),
  getLeaderboard: vi.fn(),
}));

import ProfileCard from './ProfileCard';

function wrap(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe('ProfileCard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    api.profile = { handle: null, leaderboardVisible: false, consentedAt: null };
  });

  it('sends users without a username to their account settings', async () => {
    render(wrap(<ProfileCard />));
    fireEvent.click(await screen.findByRole('button', { name: 'Set username' }));
    expect(openUserProfile).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Join leaderboard' })).toBeNull();
  });

  it('shows what will be shared before joining', async () => {
    api.profile = { handle: 'aladhi', leaderboardVisible: false, consentedAt: null };
    render(wrap(<ProfileCard />));
    expect(await screen.findByText('@aladhi')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Join leaderboard' }));
    expect(screen.getByText(/open positions, streamed live/i)).toBeDefined();
    expect(updateSocialProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Share & join' }));
    await waitFor(() => expect(screen.getByText('Sharing on leaderboard')).toBeDefined());
    expect(updateSocialProfile).toHaveBeenCalledWith({ leaderboardVisible: true });
  });
});
