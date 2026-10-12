import type { SocialProfileDto, UpdateSocialProfileRequest } from '@oggregator/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openUserProfile = vi.fn();

const EMPTY: SocialProfileDto = {
  handle: null,
  leaderboardVisible: false,
  broadcastVenue: null,
  consentedAt: null,
  venues: [],
};
const api = { profile: EMPTY };

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ openUserProfile }),
  useUser: () => ({ user: { username: api.profile.handle } }),
}));

vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', userId: 'user_1', accountId: 'acct_1' }),
}));

const updateSocialProfile = vi.fn(async (req: UpdateSocialProfileRequest) => {
  api.profile = {
    ...api.profile,
    leaderboardVisible: req.leaderboardVisible,
    broadcastVenue: req.broadcastVenue ?? api.profile.broadcastVenue,
  };
  return api.profile;
});

vi.mock('./api', () => ({
  getSocialProfile: vi.fn(async () => api.profile),
  updateSocialProfile: (req: UpdateSocialProfileRequest) => updateSocialProfile(req),
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
    api.profile = EMPTY;
  });

  it('sends users without a username to their account settings', async () => {
    render(wrap(<ProfileCard />));
    fireEvent.click(await screen.findByRole('button', { name: 'Set username' }));
    expect(openUserProfile).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Join leaderboard' })).toBeNull();
  });

  it('waits for a connected venue account before allowing a join', async () => {
    api.profile = { ...EMPTY, handle: 'aladhi' };
    render(wrap(<ProfileCard />));
    expect(await screen.findByText(/No venue account connected/)).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Join leaderboard' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('broadcasts the chosen venue account after consent', async () => {
    api.profile = {
      ...EMPTY,
      handle: 'aladhi',
      venues: [
        { venue: 'derive', connected: true },
        { venue: 'paradex', connected: true },
      ],
    };
    render(wrap(<ProfileCard />));
    fireEvent.click(await screen.findByRole('radio', { name: /Paradex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Join leaderboard' }));
    expect(screen.getByText(/Joining shares your Paradex account/)).toBeDefined();
    expect(updateSocialProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Share & join' }));
    await waitFor(() => expect(screen.getByText('Sharing on leaderboard')).toBeDefined());
    expect(updateSocialProfile).toHaveBeenCalledWith({
      leaderboardVisible: true,
      broadcastVenue: 'paradex',
    });
  });

  it('shows a waiting state while the broadcast venue is disconnected', async () => {
    api.profile = {
      ...EMPTY,
      handle: 'aladhi',
      leaderboardVisible: true,
      broadcastVenue: 'derive',
      venues: [{ venue: 'derive', connected: false }],
    };
    render(wrap(<ProfileCard />));
    expect(await screen.findByText('Waiting for Derive connection')).toBeDefined();
  });
});
