import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@hooks/useIsMobile', () => ({ useIsMobile: () => false }));

const state = {
  templates: [] as Array<{ id: string; name: string; routeType: string; fundedAbc: number }>,
  runs: [] as Array<{ id: string; status: string; abcCredited: number }>,
  detail: undefined as
    | undefined
    | { id: string; status: string; settlements: never[]; events: never[] },
};

vi.mock('./hooks/queries', () => ({
  useFundedTemplates: () => ({
    data: { templates: state.templates },
    isLoading: false,
    isError: false,
  }),
  useFundedRuns: () => ({ data: { runs: state.runs }, isLoading: false }),
  useFundedRun: () => ({ data: state.detail }),
  useStartRun: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawRun: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ChallengePanel } from './ChallengePanel';

describe('ChallengePanel', () => {
  beforeEach(() => {
    (import.meta.env as Record<string, string>).VITE_THALEX_REF_URL =
      'https://thalex.example/ref/abc';
    state.templates = [];
    state.runs = [];
    state.detail = undefined;
  });
  afterEach(() => cleanup());

  it('always renders the instant "Go funded now" CTA pointing at the ref URL', () => {
    render(<ChallengePanel runId={null} />);
    const cta = screen.getByRole('link', { name: /go funded now/i });
    expect(cta.getAttribute('href')).toBe('https://thalex.example/ref/abc');
  });

  it('does NOT render the claim CTA when the run is not test_passed', () => {
    state.detail = { id: 'run_1', status: 'test_active', settlements: [], events: [] };
    render(<ChallengePanel runId="run_1" />);
    expect(screen.queryByRole('link', { name: /claim funding/i })).toBeNull();
  });

  it('renders the claim CTA when the run is test_passed', () => {
    state.detail = { id: 'run_1', status: 'test_passed', settlements: [], events: [] };
    render(<ChallengePanel runId="run_1" />);
    const cta = screen.getByRole('link', { name: /claim funding/i });
    expect(cta.getAttribute('href')).toBe('https://thalex.example/ref/abc');
  });
});
