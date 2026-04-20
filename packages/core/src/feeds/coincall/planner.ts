import type { CachedInstrument } from '../shared/sdk-base.js';

export interface CoincallSubscriptionState {
  subscribedChannels: Set<string>;
  pendingSubscribeChannels: Set<string>;
}

export function createCoincallSubscriptionState(): CoincallSubscriptionState {
  return {
    subscribedChannels: new Set<string>(),
    pendingSubscribeChannels: new Set<string>(),
  };
}

export function buildCoincallPricingChannel(underlying: string): string {
  return `pricing.${underlying.toUpperCase()}`;
}

export function buildCoincallInitialChannels(instruments: CachedInstrument[]): string[] {
  const underlyings = new Set<string>();
  for (const instrument of instruments) {
    underlyings.add(instrument.base.toUpperCase());
  }

  return [...underlyings].map((underlying) => buildCoincallPricingChannel(underlying));
}

export function trackCoincallChannels(state: CoincallSubscriptionState, channels: string[]): string[] {
  const accepted: string[] = [];

  for (const channel of channels) {
    if (state.subscribedChannels.has(channel) || state.pendingSubscribeChannels.has(channel)) continue;
    state.pendingSubscribeChannels.add(channel);
    accepted.push(channel);
  }

  return accepted;
}

export function confirmCoincallSubscribedChannels(state: CoincallSubscriptionState, channels: string[]): void {
  for (const channel of channels) {
    state.pendingSubscribeChannels.delete(channel);
    state.subscribedChannels.add(channel);
  }
}

export function rollbackCoincallPendingChannels(state: CoincallSubscriptionState, channels: string[]): void {
  for (const channel of channels) {
    state.pendingSubscribeChannels.delete(channel);
  }
}

export function removeCoincallTrackedChannels(state: CoincallSubscriptionState, channels: string[]): void {
  for (const channel of channels) {
    state.pendingSubscribeChannels.delete(channel);
    state.subscribedChannels.delete(channel);
  }
}

export function resetCoincallSubscriptionState(state: CoincallSubscriptionState): void {
  state.pendingSubscribeChannels.clear();
  state.subscribedChannels.clear();
}
