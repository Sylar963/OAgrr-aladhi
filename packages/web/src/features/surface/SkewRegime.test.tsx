import type { CallPutFlowResponse } from '@oggregator/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  data: undefined as CallPutFlowResponse | undefined,
  refetch: vi.fn(),
  error: false,
}));

vi.mock('./queries', () => ({
  CALL_PUT_FLOW_RESOLUTION_SEC: 3600,
  useCallPutFlow: () => ({
    data: state.data,
    isError: state.error,
    isLoading: false,
    isPlaceholderData: false,
    isFetching: false,
    refetch: state.refetch,
  }),
  useIvHistory: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('./SkewRegimeChart', () => ({
  default: ({ points }: { points: { time: number }[] }) => (
    <span aria-label="last flow time">{points.at(-1)?.time ?? 'none'}</span>
  ),
  REGIME_COLORS: { 'risk-on': 'blue', neutral: 'gray', 'risk-off': 'red' },
}));

import SkewRegime from './SkewRegime';

describe('SkewRegime flow status', () => {
  afterEach(cleanup);
  beforeEach(() => {
    state.data = undefined;
    state.error = false;
    state.refetch.mockReset();
  });

  it('exposes a failed load and a retry control', () => {
    state.error = true;
    render(<SkewRegime underlying="BTC" tenor="30d" lookback="30d" />);
    expect(screen.getByRole('status').textContent).toContain('failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it('does not invent a flat regime when no flow buckets exist', () => {
    const end = Math.floor(Date.now() / 1000);
    state.data = {
      available: true,
      underlying: 'BTC',
      resolution: 3600,
      start: end - 86_400,
      end,
      buckets: [],
    };
    render(<SkewRegime underlying="BTC" tenor="30d" lookback="30d" />);
    expect(screen.getByText('insufficient history')).toBeTruthy();
    expect(screen.getByLabelText('last flow time').textContent).toBe('none');
  });

  it('stops a cached series at its last completed hour instead of padding the outage with zeros', () => {
    const end = Math.floor(Date.now() / 3600_000) * 3600;
    state.data = {
      available: true,
      underlying: 'BTC',
      resolution: 3600,
      start: end - 86_400,
      end,
      stale: true,
      updatedAt: end * 1000,
      buckets: [
        {
          ts: end - 7200,
          callCount: 1,
          putCount: 1,
          callContracts: 2,
          putContracts: 1,
          callNotionalUsd: 200,
          putNotionalUsd: 100,
          callPremiumUsd: 20,
          putPremiumUsd: 10,
        },
      ],
    };
    render(<SkewRegime underlying="BTC" tenor="30d" lookback="30d" />);
    expect(screen.getByRole('status').textContent).toContain('cached flow');
    expect(screen.getByLabelText('last flow time').textContent).toBe(String(end - 3600));
  });
});
