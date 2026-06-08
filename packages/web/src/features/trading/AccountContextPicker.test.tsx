import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const fundedState = { runs: [] as Array<{ id: string; status: string }> };
const venueState = { connected: false };

vi.mock('@features/funded', () => ({
  useFundedRuns: () => ({ data: { runs: fundedState.runs }, isLoading: false, isError: false }),
}));
vi.mock('@features/portfolio', () => ({
  venueStatus: vi.fn(async () => ({ venue: 'thalex', connected: venueState.connected })),
}));

import { useAppStore } from '@stores/app-store';
import AccountContextPicker from './AccountContextPicker';

describe('AccountContextPicker', () => {
  afterEach(() => {
    cleanup();
    fundedState.runs = [];
    venueState.connected = false;
    useAppStore.setState({ activeContext: { kind: 'paper' } });
    localStorage.clear();
  });

  it('lists only Sim Paper when no run and no thalex key', () => {
    render(<AccountContextPicker />);
    fireEvent.click(screen.getByRole('button', { name: /account/i }));
    expect(screen.getByText(/sim paper/i)).toBeDefined();
    expect(screen.queryByText(/sim challenge/i)).toBeNull();
    expect(screen.queryByText(/funded live/i)).toBeNull();
    expect(screen.getByText(/start challenge/i)).toBeDefined();
  });

  it('lists Sim Challenge when a run exists', () => {
    fundedState.runs = [{ id: 'run_1', status: 'test_active' }];
    render(<AccountContextPicker />);
    fireEvent.click(screen.getByRole('button', { name: /account/i }));
    expect(screen.getByText(/sim challenge/i)).toBeDefined();
  });

  it('selecting Sim Challenge updates activeContext', () => {
    fundedState.runs = [{ id: 'run_1', status: 'test_active' }];
    render(<AccountContextPicker />);
    fireEvent.click(screen.getByRole('button', { name: /account/i }));
    fireEvent.click(screen.getByText(/sim challenge/i));
    expect(useAppStore.getState().activeContext).toMatchObject({
      kind: 'challenge',
      runId: 'run_1',
    });
  });
});
