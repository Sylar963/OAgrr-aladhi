/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TourSpotlight from './TourSpotlight';

// jsdom has no window.matchMedia, so useIsMobile would throw if rendered for real.
// Mock it and flip this variable to exercise the mobile branch.
let mockIsMobile = false;
vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => mockIsMobile }));

// Render the four chrome targets alongside the spotlight so querySelector resolves them.
function Targets() {
  return (
    <>
      <div data-tour="views" />
      <div data-tour="asset-picker" />
      <div data-tour="venue-status" />
      <div data-tour="account" />
    </>
  );
}

beforeEach(() => {
  mockIsMobile = false;
  useAppStore.setState({ tourActive: true, tourStep: 0 });
});
afterEach(() => {
  cleanup();
  useAppStore.setState({ tourActive: false, tourStep: 0 });
});

describe('TourSpotlight', () => {
  it('renders nothing when the tour is inactive', () => {
    useAppStore.setState({ tourActive: false });
    const { container } = render(<TourSpotlight />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the first step title and step count', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByLabelText('Step 1 of 5')).toBeTruthy();
  });

  it('advances to the next step on Next, and back on Back', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('Asset picker (⌘K)')).toBeTruthy();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Views')).toBeTruthy();
  });

  it('ends the tour on Skip', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    fireEvent.click(screen.getByText('Skip'));
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('ends the tour on Escape', () => {
    render(
      <>
        <Targets />
        <TourSpotlight />
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('ends the tour when Done is clicked on the last (wrap-up) step', () => {
    useAppStore.setState({ tourActive: true, tourStep: 4 });
    render(<TourSpotlight />);
    expect(screen.getByText("That's the tour")).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(useAppStore.getState().tourActive).toBe(false);
  });

  it('skips past missing targets and lands on the wrap-up', () => {
    // No Targets rendered → every targeted step is skipped, ending on the wrap-up.
    render(<TourSpotlight />);
    expect(screen.getByText("That's the tour")).toBeTruthy();
  });

  it('renders nothing on mobile', () => {
    mockIsMobile = true;
    const { container } = render(<TourSpotlight />);
    expect(container.firstChild).toBeNull();
  });
});
