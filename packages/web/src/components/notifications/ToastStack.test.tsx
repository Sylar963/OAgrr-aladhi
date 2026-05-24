/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import ToastStack from './ToastStack';

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ToastStack', () => {
  it('renders no toast cards when the store is empty', () => {
    render(<ToastStack />);
    expect(screen.queryByLabelText('Dismiss')).toBeNull();
  });

  it('renders a toast and auto-dismisses it after 4s', () => {
    act(() => {
      useAppStore.getState().pushToast({ id: 't1', tone: 'success', icon: '✓', text: 'Feed restored' });
    });
    render(<ToastStack />);
    expect(screen.getByText('Feed restored')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(useAppStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText('Feed restored')).toBeNull();
  });
});
