// The bare `markets_summary` firehose pushes every Paradex market (~7k options across
// crypto, equities and commodities, ~4k SBE frames/s). Measured from production, the
// server drops that socket with 1006 every 90–160s even with an idle consumer, and
// pong latency climbs past 20s. Per-market channels are capped at 200 per connection
// (error 42900 "max subscriptions per connection reached"), so subscriptions are
// sharded across connections instead.
export const PARADEX_SUMMARY_CHANNEL = 'markets_summary';
export const PARADEX_MAX_SUBSCRIPTIONS_PER_CONNECTION = 200;
// Headroom below the venue cap so a late ack never pushes a shard over the limit.
export const PARADEX_SHARD_CAPACITY = 195;
// 100 subscribe frames/s trips 4032 "inbound queue full"; 50/s was stable live.
export const PARADEX_SUBSCRIBE_FRAMES_PER_TICK = 5;
export const PARADEX_SUBSCRIBE_TICK_MS = 100;
export const PARADEX_SUBSCRIPTION_CAP_ERROR = 42900;

export function paradexSummaryChannel(symbol: string): string {
  return `${PARADEX_SUMMARY_CHANNEL}.${symbol}`;
}

export function paradexSymbolFromChannel(channel: string): string | null {
  const prefix = `${PARADEX_SUMMARY_CHANNEL}.`;
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : null;
}

// Option symbols end in -C / -P (e.g. BTC-USD-12JUN26-66000-C); perps end in
// -PERP and spot has no suffix.
export function isParadexOptionSymbol(symbol: string): boolean {
  return symbol.endsWith('-C') || symbol.endsWith('-P');
}
