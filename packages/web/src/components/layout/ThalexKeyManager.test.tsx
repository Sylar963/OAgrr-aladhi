import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const portfolio = vi.hoisted(() => ({
  slots: [] as unknown[],
  slotsError: false,
  trading: { kind: 'off' } as unknown,
  refetch: vi.fn(),
  activateThalexEnvironment: vi.fn(async () => ({})),
}));
const connections = vi.hoisted(() => ({
  connectVenue: vi.fn(async () => ({})),
  disconnectVenue: vi.fn(async () => ({})),
}));

vi.mock('@features/portfolio', () => ({
  useThalexKeySlots: () =>
    portfolio.slotsError
      ? { data: undefined, isError: true, refetch: portfolio.refetch }
      : { data: { venue: 'thalex', slots: portfolio.slots }, isError: false, refetch: portfolio.refetch },
  useLiveTradingAvailability: () => ({ data: portfolio.trading }),
  activateThalexEnvironment: portfolio.activateThalexEnvironment,
}));
vi.mock('@lib/venue-connections-api', () => connections);

import ThalexKeyManager from './ThalexKeyManager';

const mainnetInUse = {
  environment: 'prod',
  configured: true,
  active: true,
  connected: true,
  kidHint: '9f3c',
  account: null,
};
const emptyTestnet = {
  environment: 'test',
  configured: false,
  active: false,
  connected: false,
  kidHint: null,
  account: null,
};

function row(name: 'Mainnet' | 'Testnet') {
  return screen.getByRole('rowheader', { name }).closest('tr')!;
}

describe('ThalexKeyManager', () => {
  beforeEach(() => {
    portfolio.slots = [mainnetInUse, emptyTestnet];
    portfolio.trading = { kind: 'off' };
    portfolio.slotsError = false;
    portfolio.refetch.mockResolvedValue({ data: { slots: portfolio.slots } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows which network and access level each stored key covers', () => {
    render(<ThalexKeyManager onChanged={vi.fn()} onError={vi.fn()} />);

    expect(within(row('Mainnet')).getByText('in use')).toBeTruthy();
    expect(within(row('Mainnet')).getByText('…9f3c')).toBeTruthy();
    expect(within(row('Testnet')).getAllByText('none')).toHaveLength(1);
    expect(within(row('Testnet')).getByText('off')).toBeTruthy();
  });

  it('saves a testnet read-only key only after the read-only confirmation', async () => {
    const onChanged = vi.fn();
    render(<ThalexKeyManager onChanged={onChanged} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Testnet' }));
    fireEvent.change(screen.getByPlaceholderText('from thalex dashboard'), { target: { value: ' kid-1 ' } });
    fireEvent.change(screen.getByPlaceholderText(/BEGIN RSA PRIVATE KEY/), { target: { value: 'PEM' } });
    const save = screen.getByRole('button', { name: 'Save testnet read-only key' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(save);

    await waitFor(() =>
      expect(connections.connectVenue).toHaveBeenCalledWith('thalex', {
        kid: 'kid-1',
        privateKeyPem: 'PEM',
        env: 'test',
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(true));
  });

  it('never offers a field for a trading key', () => {
    render(<ThalexKeyManager onChanged={vi.fn()} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Trading' }));

    expect(screen.queryByPlaceholderText(/BEGIN RSA PRIVATE KEY/)).toBeNull();
    expect(screen.getByText(/never go through the browser/)).toBeTruthy();
  });

  it('switches the portfolio to a saved network', async () => {
    portfolio.slots = [{ ...mainnetInUse }, { ...emptyTestnet, configured: true, kidHint: 'a1b2' }];
    render(<ThalexKeyManager onChanged={vi.fn()} onError={vi.fn()} />);

    fireEvent.click(within(row('Testnet')).getByRole('button', { name: 'use' }));

    await waitFor(() => expect(portfolio.activateThalexEnvironment).toHaveBeenCalledWith('test'));
  });

  it('removes only the chosen network and reports when no key is left', async () => {
    portfolio.refetch.mockResolvedValue({ data: { slots: [emptyTestnet] } });
    const onChanged = vi.fn();
    render(<ThalexKeyManager onChanged={onChanged} onError={vi.fn()} />);

    fireEvent.click(within(row('Mainnet')).getByRole('button', { name: 'remove key' }));

    await waitFor(() => expect(connections.disconnectVenue).toHaveBeenCalledWith('thalex', 'prod'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(false));
  });

  it('shows trading keys the daemon holds, per network', () => {
    portfolio.trading = {
      kind: 'ready',
      status: { tradingKeys: [{ environment: 'test', kidHint: 'a1b2', venueAccount: 'A1' }] },
    };
    render(<ThalexKeyManager onChanged={vi.fn()} onError={vi.fn()} />);

    expect(within(row('Testnet')).getByText('on daemon')).toBeTruthy();
    expect(within(row('Mainnet')).getAllByText('none')).toHaveLength(1);
  });

  it('says key status is unknown rather than showing none when it cannot be loaded', () => {
    portfolio.slotsError = true;
    render(<ThalexKeyManager onChanged={vi.fn()} onError={vi.fn()} />);

    expect(screen.getByRole('alert').textContent).toMatch(/load which keys are saved/);
    expect(within(row('Mainnet')).getByText('unknown')).toBeTruthy();
  });
});
