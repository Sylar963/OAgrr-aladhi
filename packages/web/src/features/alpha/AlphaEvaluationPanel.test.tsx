import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlphaEvaluationRequest } from '@oggregator/protocol';
import AlphaEvaluationPanel from './AlphaEvaluationPanel';
import { evaluationCandidateFixture, evaluationResponseFixture } from './evaluation.fixtures';

const mocks = vi.hoisted(() => ({ post: vi.fn(), save: vi.fn() }));
vi.mock('@lib/http', () => ({ postJson: mocks.post }));
vi.mock('./evaluation-journal', () => ({ saveEvaluation: mocks.save }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <AlphaEvaluationPanel candidate={evaluationCandidateFixture()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Evaluate this trade'));
  mocks.post.mockImplementation(async (_path: string, request: AlphaEvaluationRequest) =>
    evaluationResponseFixture(request),
  );
  return view;
}

describe('candidate evaluation UI', () => {
  it('requires explicit scenario values and sends the selected snapshot only on request', async () => {
    mount();
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Evaluate my expiry distribution'));
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate current quotes' }));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Check the quantities');
    fireEvent.change(screen.getByLabelText('Mean return to expiry · %'), {
      target: { value: '-10' },
    });
    fireEvent.change(screen.getByLabelText('Annual volatility · %'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate current quotes' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
    const submitted = mocks.post.mock.calls[0]![1] as AlphaEvaluationRequest;
    expect(submitted.scenario).toEqual({
      meanReturnPct: -10,
      annualVol: 0.5,
      meanUncertaintyPct: 0,
    });
    expect(submitted.candidate.legs).toEqual(evaluationCandidateFixture().legs);
  });

  it('saves the frozen response and blocks saving when the thesis is changed', async () => {
    mount();
    mocks.save.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText('Thesis'), { target: { value: 'Original thesis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate current quotes' }));
    await screen.findByText(/Frozen assessment/);
    fireEvent.change(screen.getByLabelText('Thesis'), {
      target: { value: 'Rewritten after observation' },
    });
    const save = screen.getByRole('button', {
      name: 'Save evaluation locally',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Thesis'), { target: { value: 'Original thesis' } });
    fireEvent.click(save);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0]![0].request.thesis).toBe('Original thesis');
    await screen.findByRole('status');
    expect(save.disabled).toBe(true);
  });

  it('surfaces storage failure without claiming that the journal saved', async () => {
    mount();
    mocks.save.mockRejectedValue(new Error('Storage quota exhausted'));
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate current quotes' }));
    await screen.findByText(/Frozen assessment/);
    fireEvent.click(screen.getByRole('button', { name: 'Save evaluation locally' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Storage quota exhausted'),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
