import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowEvidencePanel, FlowLabels } from './FlowEvidence';
import type { FlowAnalysis, FlowEvidenceResponse } from '@oggregator/protocol';

const { fetchJson } = vi.hoisted(() => ({ fetchJson: vi.fn() }));
vi.mock('@lib/http', () => ({ fetchJson }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const analysis: FlowAnalysis = {
  structure: 'PUT_SPREAD',
  linkage: 'exchange',
  completeness: 'complete',
  groupId: 'block:1',
  executionSide: 'mixed',
  sideBasis: 'legs',
  positionEffect: 'unknown',
  issues: [],
  legs: [
    {
      instrument: 'ETH-27NOV26-2200-P',
      side: 'buy',
      quantity: 9,
      expiry: '2026-11-27',
      strike: 2200,
      optionType: 'put',
    },
    {
      instrument: 'ETH-27NOV26-2100-P',
      side: 'sell',
      quantity: 9,
      expiry: '2026-11-27',
      strike: 2100,
      optionType: 'put',
    },
  ],
};

describe('FLOW evidence presentation', () => {
  it('separates a mixed-leg execution from its unknown position effect', () => {
    render(<FlowLabels analysis={analysis} />);
    expect(screen.getByText('Put Spread')).toBeTruthy();
    expect(screen.getByText('Bought + sold legs')).toBeTruthy();
    expect(screen.getByText('Reconcile OI')).toBeTruthy();
  });
  it('shows interval timing and unverified coverage next to increasing OI', async () => {
    const response: FlowEvidenceResponse = {
      analysis,
      evidence: { blockTradeId: '1', groupComplete: true },
      oi: [
        {
          instrument: 'ETH-27NOV26-2200-P',
          status: 'bracketed',
          before: { timestamp: 1793000000000, openInterest: 100 },
          after: { timestamp: 1793000900000, openInterest: 109 },
          delta: 9,
          intervalMs: 900000,
          timing: 'sampled',
          tradeCoverage: 'unverified',
        },
      ],
    };
    fetchJson.mockResolvedValue(response);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <FlowEvidencePanel
          target={{
            mode: 'institutional',
            venue: 'okx',
            underlying: 'ETH',
            tradeUid: 'x',
            instrument: 'ETH-27NOV26-2200-P',
            timestamp: 1793000000100,
          }}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Samples bracket this trade')).toBeTruthy();
    expect(screen.getByText('+9')).toBeTruthy();
    expect(screen.getByText(/assume complete tape coverage/)).toBeTruthy();
    expect(screen.queryByText(/confirmed buy to open/i)).toBeNull();
    expect(fetchJson).toHaveBeenCalledWith(expect.stringContaining('mode=institutional'));
    client.clear();
  });
  it('shows an actionable inferred closing label with the trade-side direction', () => {
    render(<FlowLabels analysis={{ ...analysis, positionEffect: 'inferred_close', legs: [{
      ...analysis.legs[0]!, position: {
        status: 'inferred_close', action: 'buy_to_close', basis: 'oi_reconciliation',
        quantity: 9, minOpening: 0, minClosing: 9, intervalVolume: 9, otherVolume: 0,
        tradeCount: 1, coverage: 'recorded', reason: 'all_volume_closing',
      },
    }] }} />);
    expect(screen.getByText('Buy to close')).toBeTruthy();
    expect(screen.getByText(/inferred/)).toBeTruthy();
    expect(screen.queryByText('Reconcile OI')).toBeNull();
  });
});
