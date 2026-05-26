// packages/web/src/components/onboarding/Onboarding.test.tsx
/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from './index';

// jsdom has no window.matchMedia; Onboarding renders useIsMobile consumers.
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});
afterEach(() => cleanup());

describe('Onboarding', () => {
  it('shows the welcome modal on first run', () => {
    render(<Onboarding />);
    expect(screen.getByText('Welcome to oggregator')).toBeTruthy();
  });

  it('does not render the welcome modal once seen', () => {
    localStorage.setItem('onboardingSeen', '1');
    render(<Onboarding />);
    expect(screen.queryByText('Welcome to oggregator')).toBeNull();
  });
});
