import type { CachedInstrument } from '../shared/sdk-base.js';

export interface OkxSubscriptionState {
  subscribedFamilies: Set<string>;
  subscribedTickers: Set<string>;
  subscribedMarkPrice: Set<string>;
}

export interface OkxSubscriptionPlan {
  families: string[];
  tickers: string[];
  markPrices: string[];
  args: object[];
}

export function createOkxSubscriptionState(): OkxSubscriptionState {
  return {
    subscribedFamilies: new Set<string>(),
    subscribedTickers: new Set<string>(),
    subscribedMarkPrice: new Set<string>(),
  };
}

export function buildOkxChainSubscriptionArgs(
  state: OkxSubscriptionState,
  underlying: string,
  instruments: CachedInstrument[],
): OkxSubscriptionPlan {
  if (instruments.length === 0) {
    return { families: [], tickers: [], markPrices: [], args: [] };
  }

  const args: object[] = [];
  const families: string[] = [];
  const tickers: string[] = [];
  const markPrices: string[] = [];
  const family = `${underlying}-USD`;

  if (!state.subscribedFamilies.has(family)) {
    families.push(family);
    args.push({ channel: 'opt-summary', instFamily: family });
  }

  for (const instrument of instruments) {
    if (!state.subscribedTickers.has(instrument.exchangeSymbol)) {
      tickers.push(instrument.exchangeSymbol);
      args.push({ channel: 'tickers', instId: instrument.exchangeSymbol });
    }

    if (!state.subscribedMarkPrice.has(instrument.exchangeSymbol)) {
      markPrices.push(instrument.exchangeSymbol);
      args.push({ channel: 'mark-price', instId: instrument.exchangeSymbol });
    }
  }

  return { families, tickers, markPrices, args };
}

export function buildOkxInstrumentSubscriptionArgs(
  state: OkxSubscriptionState,
  instruments: CachedInstrument[],
): OkxSubscriptionPlan {
  const args: object[] = [];
  const tickers: string[] = [];
  const markPrices: string[] = [];

  for (const instrument of instruments) {
    if (!state.subscribedTickers.has(instrument.exchangeSymbol)) {
      tickers.push(instrument.exchangeSymbol);
      args.push({ channel: 'tickers', instId: instrument.exchangeSymbol });
    }

    if (!state.subscribedMarkPrice.has(instrument.exchangeSymbol)) {
      markPrices.push(instrument.exchangeSymbol);
      args.push({ channel: 'mark-price', instId: instrument.exchangeSymbol });
    }
  }

  return { families: [], tickers, markPrices, args };
}

export function markOkxSubscribed(
  state: OkxSubscriptionState,
  plan: OkxSubscriptionPlan,
): void {
  for (const family of plan.families) {
    state.subscribedFamilies.add(family);
  }
  for (const ticker of plan.tickers) {
    state.subscribedTickers.add(ticker);
  }
  for (const markPrice of plan.markPrices) {
    state.subscribedMarkPrice.add(markPrice);
  }
}

export function removeOkxSubscribedFamily(state: OkxSubscriptionState, family: string): void {
  state.subscribedFamilies.delete(family);
}

export function buildOkxReplayArgs(state: OkxSubscriptionState): object[] {
  return [
    ...[...state.subscribedFamilies].map((family) => ({
      channel: 'opt-summary',
      instFamily: family,
    })),
    ...[...state.subscribedTickers].map((id) => ({ channel: 'tickers', instId: id })),
    ...[...state.subscribedMarkPrice].map((id) => ({ channel: 'mark-price', instId: id })),
  ];
}

export function buildOkxUnsubscribeArgs(state: OkxSubscriptionState): object[] {
  return buildOkxReplayArgs(state);
}

export function removeOkxSubscribedInstruments(
  state: OkxSubscriptionState,
  exchangeSymbols: string[],
): void {
  for (const exchangeSymbol of exchangeSymbols) {
    state.subscribedTickers.delete(exchangeSymbol);
    state.subscribedMarkPrice.delete(exchangeSymbol);
  }
}

export function resetOkxSubscriptionState(state: OkxSubscriptionState): void {
  state.subscribedFamilies.clear();
  state.subscribedTickers.clear();
  state.subscribedMarkPrice.clear();
}
