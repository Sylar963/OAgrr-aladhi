// Subscription planning: which DXFeed event types per contract, batching,
// and lifecycle (open/close per ChainRequest). Mirrors planner.ts in other venues.

export type DxFeedEventType = 'Quote' | 'Trade' | 'Greeks' | 'Summary' | 'TheoPrice';

export interface TastytradeSubscription {
  streamerSymbol: string;
  eventTypes: DxFeedEventType[];
}

export interface TastytradeSubscriptionState {
  subscriptionsByKey: Map<string, TastytradeSubscription>;
  /** key = `${underlying}|${expiry}` → set of streamer symbols */
  symbolsByChain: Map<string, Set<string>>;
}

export function createTastytradeSubscriptionState(): TastytradeSubscriptionState {
  return {
    subscriptionsByKey: new Map(),
    symbolsByChain: new Map(),
  };
}

const DEFAULT_EVENTS: DxFeedEventType[] = ['Quote', 'Greeks', 'Trade', 'Summary'];

export function buildTastytradeSubscriptionPlan(
  _underlying: string,
  _expiry: string,
  _streamerSymbols: string[],
): TastytradeSubscription[] {
  void DEFAULT_EVENTS;
  throw new Error('buildTastytradeSubscriptionPlan not implemented');
}

export function releaseTastytradeSubscription(
  _state: TastytradeSubscriptionState,
  _underlying: string,
  _expiry: string,
): string[] {
  // Returns streamer symbols safe to FEED_UNSUBSCRIBE (no other chain needs them).
  throw new Error('releaseTastytradeSubscription not implemented');
}
