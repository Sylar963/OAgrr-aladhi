export interface GateioSubscriptionState {
  contracts: Set<string>;
  underlyings: Set<string>;
  contractsByUnderlying: Map<string, Set<string>>;
}

export interface GateioFrame {
  time: number;
  channel: string;
  event: 'subscribe' | 'unsubscribe';
  payload: string[];
}

const MAX_CONTRACTS_PER_FRAME = 50;

export function createGateioSubscriptionState(): GateioSubscriptionState {
  return {
    contracts: new Set(),
    underlyings: new Set(),
    contractsByUnderlying: new Map(),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function trackContracts(
  state: GateioSubscriptionState,
  contracts: string[],
  underlying: string,
): void {
  const set = state.contractsByUnderlying.get(underlying) ?? new Set<string>();
  for (const c of contracts) {
    state.contracts.add(c);
    set.add(c);
  }
  state.contractsByUnderlying.set(underlying, set);
  state.underlyings.add(underlying);
}

function untrackContracts(
  state: GateioSubscriptionState,
  contracts: string[],
  underlying: string,
): void {
  const set = state.contractsByUnderlying.get(underlying);
  for (const c of contracts) {
    state.contracts.delete(c);
    set?.delete(c);
  }
  if (!set || set.size === 0) {
    state.contractsByUnderlying.delete(underlying);
    state.underlyings.delete(underlying);
  }
}

export function buildGateioSubscribeFrames(
  state: GateioSubscriptionState,
  contracts: string[],
  underlying: string,
  now: () => number,
): GateioFrame[] {
  trackContracts(state, contracts, underlying);
  const time = now();
  const frames: GateioFrame[] = [];

  for (const batch of chunk(contracts, MAX_CONTRACTS_PER_FRAME)) {
    frames.push({ time, channel: 'options.contract_tickers', event: 'subscribe', payload: batch });
  }
  for (const batch of chunk(contracts, MAX_CONTRACTS_PER_FRAME)) {
    frames.push({ time, channel: 'options.trades', event: 'subscribe', payload: batch });
  }
  frames.push({
    time,
    channel: 'options.ul_tickers',
    event: 'subscribe',
    payload: [underlying],
  });
  return frames;
}

export function buildGateioUnsubscribeFrames(
  state: GateioSubscriptionState,
  contracts: string[],
  underlying: string,
  now: () => number,
): GateioFrame[] {
  const time = now();
  const frames: GateioFrame[] = [];

  for (const batch of chunk(contracts, MAX_CONTRACTS_PER_FRAME)) {
    frames.push({ time, channel: 'options.contract_tickers', event: 'unsubscribe', payload: batch });
    frames.push({ time, channel: 'options.trades', event: 'unsubscribe', payload: batch });
  }

  untrackContracts(state, contracts, underlying);

  if (!state.underlyings.has(underlying)) {
    frames.push({
      time,
      channel: 'options.ul_tickers',
      event: 'unsubscribe',
      payload: [underlying],
    });
  }
  return frames;
}

export function buildGateioReplayFrames(
  state: GateioSubscriptionState,
  now: () => number,
): GateioFrame[] {
  const frames: GateioFrame[] = [];
  const time = now();
  for (const [underlying, set] of state.contractsByUnderlying) {
    const contracts = [...set];
    if (contracts.length === 0) continue;
    for (const batch of chunk(contracts, MAX_CONTRACTS_PER_FRAME)) {
      frames.push({ time, channel: 'options.contract_tickers', event: 'subscribe', payload: batch });
      frames.push({ time, channel: 'options.trades', event: 'subscribe', payload: batch });
    }
    frames.push({
      time,
      channel: 'options.ul_tickers',
      event: 'subscribe',
      payload: [underlying],
    });
  }
  return frames;
}

export function pruneGateioSubscriptionState(
  state: GateioSubscriptionState,
  shouldKeep: (contract: string, underlying: string) => boolean,
): void {
  for (const [underlying, set] of state.contractsByUnderlying) {
    for (const contract of [...set]) {
      if (shouldKeep(contract, underlying)) continue;
      set.delete(contract);
      state.contracts.delete(contract);
    }
    if (set.size > 0) continue;
    state.contractsByUnderlying.delete(underlying);
    state.underlyings.delete(underlying);
  }
}
