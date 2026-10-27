import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PortfolioAssistantEvidence, PortfolioMetrics, PositionLeg } from '@oggregator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), stop: vi.fn(), start: vi.fn() }));
vi.mock('@components/auth/AccountSessionProvider', () => ({ useAccountSession: () => ({ status: 'ready', accountId: 'account' }) }));
vi.mock('./hooks', () => ({
  PORTFOLIO_ASSISTANT_QKEY: { access: () => ['access'] },
  usePortfolioAssistantAccess: () => ({ data: { enabled: true }, isLoading: false }),
  usePortfolioAssistantThread: () => ({ threadId: 'thread', isLoading: false, startNewChat: mocks.start }),
  usePortfolioAssistantConversation: () => ({ messages: [], isLoading: false, isStreaming: false, sendMessage: mocks.send, stop: mocks.stop }),
  usePortfolioAssistantFeedback: () => new Map(),
}));

import { PortfolioAssistantBriefing } from './PortfolioAssistantBriefing';
import { PortfolioAssistantEvidence as Evidence } from './PortfolioAssistantEvidence';
import { PortfolioAssistantPanel } from './PortfolioAssistantPanel';

const POSITION: PositionLeg = {
  legId: 'held', underlying: 'BTC', expiry: '2026-11-27', strike: 80_000, optionRight: 'call', size: 1,
  entryPriceUsd: 1000, entryIv: null, realizedPnlUsd: 0, entryTs: 1, venueHint: null, source: 'manual',
};
const METRICS = {
  generatedAt: Date.now(), totals: { netDeltaCoin: 0.5, netThetaUsd: -12 },
  breakEven: [{ legId: 'held', currentMarkUsd: 100 }], byExpiry: [{ expiry: '2026-11-27', theta: -12 }],
} as unknown as PortfolioMetrics;

const EVIDENCE: PortfolioAssistantEvidence = {
  version: 1, intent: 'portfolio',
  snapshot: {
    generatedAt: 1, source: 'manual', underlying: 'BTC', network: null, forwardDays: 7, dataState: 'partial',
    spotUsd: 80_000, unrealizedPnlUsd: null, netDeltaCoin: 0.5, netThetaUsd: -12, netVegaUsd: 4,
    equityUsd: null, openLegCount: 1, positionsTruncated: false,
    positions: [{ ...POSITION, markUsd: null, markUpdatedAt: null }],
  },
  contextSections: ['portfolio'], relevantLegIds: ['held'], assumptions: ['snapshot_not_quote_time'],
  gaps: ['Missing mark for held position.'], actions: ['positions', 'scenario', 'alternatives'], comparison: null,
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Hermes portfolio briefing', () => {
  it('uses actual expiry and theta and shows the missing-data question only when needed', () => {
    const send = vi.fn();
    const props = { metrics: METRICS, positions: [POSITION], forwardDays: 7, disabled: false, onSend: send };
    const { rerender } = render(<PortfolioAssistantBriefing {...props} />);
    expect(screen.queryByText(/positions have no mark/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /theta contribution of expiry 2026-11-27/ }));
    expect(send).toHaveBeenCalledWith('Explain the theta contribution of expiry 2026-11-27.');
    rerender(<PortfolioAssistantBriefing {...props} metrics={{ ...METRICS, breakEven: [] }} />);
    expect(screen.getByText(/1 positions have no mark/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Which positions have missing marks/ })).toBeTruthy();
  });

  it('does not invent a portfolio summary while metrics load', () => {
    render(<PortfolioAssistantBriefing metrics={null} positions={[]} forwardDays={7} disabled onSend={vi.fn()} />);
    expect(screen.getByText('Waiting for portfolio analytics.')).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Hermes evidence and expanded chat', () => {
  it('shows source data and routes only typed actions with the saved evidence', () => {
    const onAction = vi.fn();
    render(<Evidence evidence={EVIDENCE} generatedAt={1} onAction={onAction} />);
    fireEvent.click(screen.getByText('Evidence & assumptions'));
    expect(screen.getByText('Missing mark for held position.')).toBeTruthy();
    expect(screen.getByText(/not proof that every quote is fresh/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View affected positions' }));
    expect(onAction).toHaveBeenCalledWith('positions', EVIDENCE);
  });

  it('expands accessibly, preserves the draft, and restores the page on Escape', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><PortfolioAssistantPanel source="manual" underlying="BTC" forwardDays={7} generatedAt={METRICS.generatedAt} metrics={METRICS} positions={[POSITION]} /></QueryClientProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Expand chat' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('My draft');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('My draft');
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
