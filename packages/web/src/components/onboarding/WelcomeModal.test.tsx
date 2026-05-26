/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WelcomeModal from './WelcomeModal';

// jsdom has no window.matchMedia, so useIsMobile would throw if rendered for real.
// Mock it and flip this variable to exercise the mobile branch.
let mockIsMobile = false;
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => mockIsMobile }));

beforeEach(() => {
  mockIsMobile = false;
  localStorage.clear();
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});
afterEach(() => cleanup());

describe('WelcomeModal', () => {
  it('shows on first run', () => {
    render(<WelcomeModal />);
    expect(screen.getByText('Welcome to oggregator')).toBeTruthy();
  });

  it('does not show once onboarding has been seen', () => {
    localStorage.setItem('onboardingSeen', '1');
    render(<WelcomeModal />);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('"Take the tour" marks seen, closes, and starts the tour', () => {
    render(<WelcomeModal />);
    fireEvent.click(screen.getByText('Take the tour'));
    expect(localStorage.getItem('onboardingSeen')).toBe('1');
    expect(useAppStore.getState().tourActive).toBe(true);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('"Skip" marks seen and closes without starting the tour', () => {
    render(<WelcomeModal />);
    fireEvent.click(screen.getByText('Skip'));
    expect(localStorage.getItem('onboardingSeen')).toBe('1');
    expect(useAppStore.getState().tourActive).toBe(false);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('Esc closes the modal', () => {
    render(<WelcomeModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });

  it('on mobile shows only "Got it" (no tour)', () => {
    mockIsMobile = true;
    render(<WelcomeModal />);
    expect(screen.getByText('Got it')).toBeTruthy();
    expect(screen.queryByText('Take the tour')).toBeNull();
    expect(screen.queryByText('Skip')).toBeNull();
  });
});
