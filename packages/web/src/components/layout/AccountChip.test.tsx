import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const clerkState = { signedIn: false };

vi.mock('@clerk/clerk-react', () => ({
  SignedIn: ({ children }: { children: ReactElement }) => (clerkState.signedIn ? children : null),
  SignedOut: ({ children }: { children: ReactElement }) => (clerkState.signedIn ? null : children),
  SignInButton: ({ children }: { children?: ReactElement }) => (
    <div data-testid="sign-in-button">{children ?? 'Sign in'}</div>
  ),
  UserButton: () => <div data-testid="user-button" />,
  useAuth: () => ({ getToken: async () => 'tok', isSignedIn: clerkState.signedIn }),
  useUser: () => ({
    user: clerkState.signedIn ? { id: 'user_1' } : null,
    isSignedIn: clerkState.signedIn,
  }),
}));

vi.mock('@features/trading/api', () => ({
  syncAuth: vi.fn(async () => ({ accountId: 'acct_1' })),
}));
vi.mock('@features/portfolio/api', () => ({
  connectVenue: vi.fn(),
  disconnectVenue: vi.fn(),
  venueStatus: vi.fn(async () => ({ connected: false })),
}));

import AccountChip from './AccountChip';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('AccountChip', () => {
  afterEach(() => {
    cleanup();
    clerkState.signedIn = false;
  });

  it('shows a sign-in button when signed out', () => {
    clerkState.signedIn = false;
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByTestId('sign-in-button')).toBeDefined();
  });

  it('shows the Clerk user button when signed in', () => {
    clerkState.signedIn = true;
    render(wrap(<AccountChip />));
    fireEvent.click(screen.getByRole('button', { name: /account/i }));
    expect(screen.getByTestId('user-button')).toBeDefined();
  });
});
