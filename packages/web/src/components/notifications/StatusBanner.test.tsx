/**
 * @vitest-environment jsdom
 */

import type { ActiveNotice } from '@lib/system-status';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusBanner from './StatusBanner';

const NOW = 1_700_000_000_000;
const info: ActiveNotice = {
  id: 'a1',
  severity: 'info',
  title: 'Scheduled maintenance',
  dismissible: true,
};

afterEach(() => cleanup());

describe('StatusBanner', () => {
  it('renders the title and a dismiss button when dismissible', () => {
    const onDismiss = vi.fn();
    render(<StatusBanner notice={info} now={NOW} onDismiss={onDismiss} />);
    expect(screen.getByText('Scheduled maintenance')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('hides the dismiss button for non-dismissible notices', () => {
    const degraded: ActiveNotice = {
      id: null,
      severity: 'degraded',
      title: 'Live feed disconnected',
      dismissible: false,
    };
    render(<StatusBanner notice={degraded} now={NOW} onDismiss={() => {}} />);
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('shows a countdown when startsAt is in the future', () => {
    const scheduled: ActiveNotice = { ...info, startsAt: NOW + 2 * 60 * 60 * 1000 };
    render(<StatusBanner notice={scheduled} now={NOW} onDismiss={() => {}} />);
    expect(screen.getByText(/in 2h/)).toBeTruthy();
  });

  it('renders the optional message', () => {
    const withMsg: ActiveNotice = { ...info, message: 'Feeds may briefly drop' };
    render(<StatusBanner notice={withMsg} now={NOW} onDismiss={() => {}} />);
    expect(screen.getByText('Feeds may briefly drop')).toBeTruthy();
  });

  it('uses an assertive alert role for critical severities', () => {
    const outage: ActiveNotice = {
      id: 'o1',
      severity: 'outage',
      title: 'Down',
      dismissible: false,
    };
    render(<StatusBanner notice={outage} now={NOW} onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('uses a polite status role for info severity', () => {
    render(<StatusBanner notice={info} now={NOW} onDismiss={() => {}} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
