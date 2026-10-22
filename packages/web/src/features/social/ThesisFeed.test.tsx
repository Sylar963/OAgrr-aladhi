import type { PublicThesisDto, PublicThesisFeed, ThesisView } from '@oggregator/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const HOUR_MS = 3_600_000;
const now = Date.now();

function publicThesis(id: string, overrides: Partial<PublicThesisDto>): PublicThesisDto {
  return {
    id,
    handle: 'satoshi',
    isMe: false,
    underlying: 'BTC',
    direction: 'bearish',
    horizonExpiry: new Date(now + 5 * 24 * HOUR_MS).toISOString().slice(0, 10),
    level: 90_000,
    confirmSec: 86400,
    reason: 'Failed breakout above 88k with funding hot; expect a retest of 80k.',
    state: 'active',
    status: 'INTACT',
    roomPct: 0.05,
    spotAtCreation: 86_000,
    spotUsd: 84_280,
    createdAt: now - 2 * HOUR_MS,
    sharedAt: now - 2 * HOUR_MS,
    endedAt: null,
    endNote: null,
    ...overrides,
  };
}

const feed: PublicThesisFeed = {
  generatedAt: now,
  theses: [
    publicThesis('00000000-0000-4000-8000-000000000001', {}),
    publicThesis('00000000-0000-4000-8000-000000000002', {
      handle: 'me',
      isMe: true,
      underlying: 'ETH',
      direction: 'bullish',
      level: 2_000,
      spotAtCreation: 2_400,
      spotUsd: 2_300,
    }),
    publicThesis('00000000-0000-4000-8000-000000000003', {
      handle: 'hal',
      state: 'overridden',
      status: null,
      endedAt: now - HOUR_MS,
      endNote: 'Reclaimed 88k on volume, I was wrong.',
    }),
  ],
};

const privateView = {
  thesis: {
    id: '00000000-0000-4000-8000-000000000009',
    underlying: 'SOL',
    direction: 'bearish',
    horizonExpiry: '2026-10-30',
    share: null,
  },
} as unknown as ThesisView;

const shareThesis = vi.fn(async () => ({}));

vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', userId: 'user_1', accountId: 'acct_1' }),
}));

vi.mock('./api', () => ({
  getThesisFeed: vi.fn(async () => feed),
  getLeaderboard: vi.fn(async () => ({
    period: 'all',
    generatedAt: new Date(now).toISOString(),
    entries: [{ handle: 'satoshi' }],
  })),
}));

vi.mock('@features/thesis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/thesis')>()),
  shareThesis: (id: string, shared: boolean) => shareThesis(id, shared),
  useTheses: () => ({ data: { active: [privateView], reversalCooldowns: [] } }),
  useThesisRefresh: () => async () => {},
}));

import ThesisFeed from './ThesisFeed';

function renderFeed(selectedHandle: string | null = null, onSelectTrader = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThesisFeed selectedHandle={selectedHandle} onSelectTrader={onSelectTrader} />
    </QueryClientProvider>,
  );
  return onSelectTrader;
}

const cards = () => screen.getAllByRole('article');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThesisFeed', () => {
  it('shows each shared thesis with its outcome, and opens ranked traders', async () => {
    const onSelectTrader = renderFeed();
    await waitFor(() => expect(cards()).toHaveLength(3));

    const [btc, eth, flipped] = cards();
    expect(within(btc!).getByText('Intact')).toBeTruthy();
    expect(within(btc!).getByText(/−2\.0%/).getAttribute('data-favorable')).toBe('true');
    expect(within(eth!).getByText(/−4\.2%/).getAttribute('data-favorable')).toBe('false');
    expect(within(flipped!).getByText('Flipped')).toBeTruthy();
    expect(within(flipped!).getByText(/I was wrong/)).toBeTruthy();
    expect(within(flipped!).queryByRole('button', { name: '@hal' })).toBeNull();

    await waitFor(() => within(btc!).getByRole('button', { name: '@satoshi' }));
    fireEvent.click(within(btc!).getByRole('button', { name: '@satoshi' }));
    expect(onSelectTrader).toHaveBeenCalledWith('satoshi');
  });

  it('filters by scope and underlying', async () => {
    renderFeed();
    await waitFor(() => expect(cards()).toHaveLength(3));
    fireEvent.click(screen.getByRole('tab', { name: 'Active' }));
    expect(cards()).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'ETH' }));
    expect(cards()).toHaveLength(1);
  });

  it('narrows to the selected leaderboard trader until dismissed', async () => {
    renderFeed('satoshi');
    await waitFor(() => expect(cards()).toHaveLength(1));
    fireEvent.click(screen.getByTitle("Show every trader's theses"));
    expect(cards()).toHaveLength(3);
  });

  it('offers to share a private active thesis and to withdraw a shared one', async () => {
    renderFeed();
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(screen.getByText(/thesis until .* is private/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(shareThesis).toHaveBeenCalledWith(privateView.thesis.id, true));

    fireEvent.click(within(cards()[1]!).getByRole('button', { name: 'Withdraw from feed' }));
    await waitFor(() =>
      expect(shareThesis).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002', false),
    );
  });
});
