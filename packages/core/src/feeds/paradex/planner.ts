// Paradex exposes a single all-markets summary firehose. Subscribing with no
// symbol suffix delivers every market in one channel — the whole option chain
// in one subscription (sidesteps the ~200-subscriptions/connection cap).
export const PARADEX_SUMMARY_CHANNEL = 'markets_summary';

// Option symbols end in -C / -P (e.g. BTC-USD-12JUN26-66000-C); perps end in
// -PERP and spot has no suffix.
export function isParadexOptionSymbol(symbol: string): boolean {
  return symbol.endsWith('-C') || symbol.endsWith('-P');
}
