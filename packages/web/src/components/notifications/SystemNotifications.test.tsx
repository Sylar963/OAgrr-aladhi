/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemNotifications } from './index';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useAppStore.setState((s) => ({
    announcement: null,
    feedDegraded: false,
    toasts: [],
    feedStatus: { ...s.feedStatus, connectionState: 'live', failedVenueIds: [] },
    activeVenues: ['deribit'],
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SystemNotifications', () => {
  it('renders a banner for a non-blocking announcement', () => {
    useAppStore.setState({
      announcement: { id: 'a1', severity: 'notice', blocking: false, title: 'Under construction' },
    });
    render(<SystemNotifications />);
    expect(screen.getByText('Under construction')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a takeover for a blocking announcement', () => {
    useAppStore.setState({
      announcement: { id: 'o1', severity: 'outage', blocking: true, title: 'Down for maintenance' },
    });
    render(<SystemNotifications />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('renders the degraded feed banner when feedDegraded is set', () => {
    useAppStore.setState({ feedDegraded: true });
    render(<SystemNotifications />);
    expect(screen.getByText('Live feed disconnected')).toBeTruthy();
  });

  it('dismisses a banner and remembers it', () => {
    useAppStore.setState({
      announcement: { id: 'a1', severity: 'info', blocking: false, title: 'Scheduled maintenance' },
    });
    render(<SystemNotifications />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText('Scheduled maintenance')).toBeNull();
    expect(localStorage.getItem('systemAnnouncementDismissed')).toContain('a1');
  });

  it('expires a banner once endsAt passes', () => {
    const now = Date.now();
    useAppStore.setState({
      announcement: {
        id: 'e1',
        severity: 'info',
        blocking: false,
        title: 'Ending soon',
        endsAt: now + 5000,
      },
    });
    render(<SystemNotifications />);
    expect(screen.getByText('Ending soon')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('Ending soon')).toBeNull();
  });
});
