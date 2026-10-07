import type { PortfolioAssistantFeedback as Feedback } from '@oggregator/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  submitPortfolioAssistantFeedback: vi.fn(),
  fetchPortfolioAssistantFeedback: vi.fn(),
}));

vi.mock('./api', () => api);
vi.mock('@components/auth/AccountSessionProvider', () => ({
  useAccountSession: () => ({ status: 'ready', accountId: 'acct-1' }),
}));

import { PortfolioAssistantFeedback } from './PortfolioAssistantFeedback';
import { PortfolioAssistantTranscript } from './PortfolioAssistantTranscript';

const THREAD = '22222222-2222-4222-8222-222222222222';
const MESSAGE = '11111111-1111-4111-8111-111111111111';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderFeedback(feedback?: Feedback) {
  return render(
    <PortfolioAssistantFeedback threadId={THREAD} messageId={MESSAGE} feedback={feedback} />,
    { wrapper: wrapper() },
  );
}

beforeEach(() => {
  api.submitPortfolioAssistantFeedback.mockImplementation(
    async (
      _threadId: string,
      messageId: string,
      input: { vote: 'up' | 'down'; reasons?: string[]; note?: string },
    ) => ({
      messageId,
      vote: input.vote,
      reasons: input.reasons ?? [],
      note: input.note ?? null,
      updatedAt: 1,
    }),
  );
  api.fetchPortfolioAssistantFeedback.mockResolvedValue({ feedback: [] });
});

afterEach(cleanup);

describe('PortfolioAssistantFeedback', () => {
  it('records a thumbs up', async () => {
    renderFeedback();
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    await waitFor(() =>
      expect(api.submitPortfolioAssistantFeedback).toHaveBeenCalledWith(THREAD, MESSAGE, {
        vote: 'up',
      }),
    );
    expect(await screen.findByText('Thanks for the feedback')).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('records a thumbs down at once, then sends optional reasons and a note', async () => {
    renderFeedback();
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    await waitFor(() =>
      expect(api.submitPortfolioAssistantFeedback).toHaveBeenCalledWith(THREAD, MESSAGE, {
        vote: 'down',
        reasons: [],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Wrong numbers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Too long' }));
    fireEvent.click(screen.getByRole('button', { name: 'Too long' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refused' }));
    expect(screen.getByRole('button', { name: 'Wrong numbers' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.change(screen.getByLabelText('Feedback note'), {
      target: { value: '  max loss ignores the short call  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(api.submitPortfolioAssistantFeedback).toHaveBeenLastCalledWith(THREAD, MESSAGE, {
        vote: 'down',
        reasons: ['wrong_numbers', 'refused'],
        note: 'max loss ignores the short call',
      }),
    );
    expect(await screen.findByText('Thanks for the feedback')).toBeTruthy();
  });

  it('limits the note to 200 characters', () => {
    renderFeedback({ messageId: MESSAGE, vote: 'down', reasons: [], note: null, updatedAt: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(screen.getByLabelText('Feedback note').getAttribute('maxLength')).toBe('200');
  });

  it('shows the stored vote and reopens its reasons without voting again', () => {
    renderFeedback({
      messageId: MESSAGE,
      vote: 'down',
      reasons: ['did_not_answer'],
      note: 'asked about vega',
      updatedAt: 1,
    });
    const down = screen.getByRole('button', { name: 'Not helpful' });
    expect(down.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Helpful' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    fireEvent.click(down);
    expect(api.submitPortfolioAssistantFeedback).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: "Didn't answer" }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect((screen.getByLabelText('Feedback note') as HTMLInputElement).value).toBe(
      'asked about vega',
    );
  });

  it('changes a down vote to an up vote', async () => {
    renderFeedback({ messageId: MESSAGE, vote: 'down', reasons: [], note: null, updatedAt: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    await waitFor(() =>
      expect(api.submitPortfolioAssistantFeedback).toHaveBeenCalledWith(THREAD, MESSAGE, {
        vote: 'up',
      }),
    );
  });

  it('shows a save error', async () => {
    api.submitPortfolioAssistantFeedback.mockRejectedValue(
      new Error('Feedback storage is unavailable.'),
    );
    renderFeedback();
    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Feedback storage is unavailable.');
  });
});

describe('PortfolioAssistantTranscript feedback', () => {
  const base = { portfolioGeneratedAt: null, createdAt: 1 };

  beforeEach(() => {
    // jsdom has no layout, so scrollIntoView is missing.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('offers votes only on completed assistant answers and shows stored votes', async () => {
    api.fetchPortfolioAssistantFeedback.mockResolvedValue({
      feedback: [{ messageId: MESSAGE, vote: 'up', reasons: [], note: null, updatedAt: 1 }],
    });
    render(
      <PortfolioAssistantTranscript
        isLoading={false}
        feedbackThreadId={THREAD}
        messages={[
          {
            ...base,
            messageId: '33333333-3333-4333-8333-333333333333',
            role: 'user',
            content: 'q',
            status: 'complete',
          },
          { ...base, messageId: MESSAGE, role: 'assistant', content: 'answer', status: 'complete' },
          {
            ...base,
            messageId: '44444444-4444-4444-8444-444444444444',
            role: 'assistant',
            content: 'partial',
            status: 'cancelled',
          },
        ]}
      />,
      { wrapper: wrapper() },
    );
    const helpful = screen.getAllByRole('button', { name: 'Helpful' });
    expect(helpful).toHaveLength(1);
    await waitFor(() => expect(helpful[0]!.getAttribute('aria-pressed')).toBe('true'));
    expect(api.fetchPortfolioAssistantFeedback).toHaveBeenCalledWith(THREAD);
  });

  it('hides votes without a thread', () => {
    render(
      <PortfolioAssistantTranscript
        isLoading={false}
        messages={[
          { ...base, messageId: MESSAGE, role: 'assistant', content: 'answer', status: 'complete' },
        ]}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.queryByRole('button', { name: 'Helpful' })).toBeNull();
    expect(api.fetchPortfolioAssistantFeedback).not.toHaveBeenCalled();
  });
});
