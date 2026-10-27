import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { channel, summarize } from './model.mjs';
import { loadHistory } from './history.mjs';
import { PATTERN_RULES, patternBacktest, patternSignals } from './patterns.mjs';

const require = createRequire(new URL('../../../packages/core/package.json', import.meta.url));
const log = require('pino')();
const DAY = 86_400_000;
const END = Date.UTC(2026, 9, 26);
const START = END - 180 * DAY;
const SPLIT = END - 60 * DAY;
const CHECK_START = Date.UTC(2026, 0, 1);
const configs = [];
for (const [length, multiplier] of [[60, 3], [130, 4]]) {
  for (const kind of ['v', 'equal']) for (const side of [1, -1]) {
    for (const target of ['middle', 'opposite']) for (const holdBars of [12, 48]) {
      configs.push({ id: `${length}-${multiplier}-${kind}-${side === 1 ? 'long' : 'short'}-${target}-${holdBars * 5}m`, length, multiplier, kind, side, target, holdBars });
    }
  }
}
const plan = {
  rules: PATTERN_RULES, configs,
  selection: 'Rank April 29–August 26 mean return after 9 bps friction, minimum 30 trades. Freeze the best three before fetching January 1–April 28 data. Report all 32 variants, including losses.',
  validation: 'August 27–October 25 is previously inspected comparison data. January 1–April 28 is an unseen earlier-period robustness check, not chronological forward validation. No further tuning after checking it.',
  limitations: 'OHLC fills, stop first if both exits hit, fixed 9 bps trading friction, funding excluded, no gamma or trend filter, not a complete discretionary trading model.',
};
await fs.writeFile(new URL('./pattern-plan.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n');
const candles = await loadHistory(START - 5 * DAY, END);
const cached = new Map();
function inputs(data, config, cache) {
  const bandKey = `${config.length}-${config.multiplier}`;
  if (!cache.has(bandKey)) cache.set(bandKey, channel(data, config));
  const bands = cache.get(bandKey);
  const signalKey = `${bandKey}-${config.kind}-${config.side}`;
  if (!cache.has(signalKey)) cache.set(signalKey, patternSignals(data, bands, config.side, config.kind));
  return { bands, signals: cache.get(signalKey) };
}
const results = configs.map(config => {
  const { bands, signals } = inputs(candles, config, cached);
  const fit = patternBacktest(candles, bands, signals, START, SPLIT, config);
  const comparison = patternBacktest(candles, bands, signals, SPLIT, END, config);
  return { config, fit: summarize(fit, START, SPLIT), comparison: summarize(comparison, SPLIT, END) };
});
const score = result => result.fit.grossMeanBps - 9;
const selected = results.filter(r => r.fit.trades >= 30).sort((a, b) => score(b) - score(a)).slice(0, 3).map(r => r.config);
await fs.writeFile(new URL('./pattern-selection.json', import.meta.url), JSON.stringify({ selection: plan.selection, selected }, null, 2) + '\n');
log.info({ selected: selected.map(c => c.id), variants: configs.length }, 'selection frozen before earlier-period check');
const earlier = await loadHistory(CHECK_START - 5 * DAY, START);
const checkCache = new Map();
const checks = selected.map(config => {
  const { bands, signals } = inputs(earlier, config, checkCache);
  const trades = patternBacktest(earlier, bands, signals, CHECK_START, START, config);
  return { config, summary: summarize(trades, CHECK_START, START), trades };
});
const venues = [
  { name: 'Thalex tier 1 perpetual market orders', takerBpsPerSide: 5, spreadSlippageBpsPerSide: 1, roundTripBps: 12, source: 'https://support.thalex.com/hc/en-us/articles/7079268315665-What-trading-fees-does-Thalex-charge' },
  { name: 'Bybit VIP 0 perpetual market orders', takerBpsPerSide: 5.5, spreadSlippageBpsPerSide: 1, roundTripBps: 13, source: 'https://www.bybit.com/en/help-center/article/Trading-Fee-Structure' },
];
function atVenueCost(summary, cost) {
  if (!summary.trades) return { trades: 0 };
  return {
    trades: summary.trades,
    meanGrossBps: summary.grossMeanBps,
    meanAfterCostsBps: summary.grossMeanBps - cost,
    meanAfterCosts95: summary.meanAfter9BpsWeekBootstrap95.map(value => value + 9 - cost),
  };
}
for (const check of checks) {
  await fs.writeFile(new URL(`./.cache/${check.config.id}-earlier-trades.json`, import.meta.url), JSON.stringify(check.trades, null, 2));
}
const report = {
  plan,
  data: { originalSha256: createHash('sha256').update(JSON.stringify(candles)).digest('hex'), earlierSha256: createHash('sha256').update(JSON.stringify(earlier)).digest('hex'), missingBars: 0, timezone: 'UTC' },
  results,
  earlierChecks: checks.map(({ config, summary }) => ({ config, summary })),
  venueCosts: {
    checkedOnClientDate: '2026-10-26',
    scope: 'Published standard-tier perpetual taker rates applied to the same Deribit reference candles; not venue-native execution backtests. Account tiers unverified. Funding and size-dependent impact excluded. One bp per side spread/slippage is assumed.',
    venues: venues.map(venue => ({
      ...venue,
      results: results.map(result => ({ id: result.config.id, fit: atVenueCost(result.fit, venue.roundTripBps), comparison: atVenueCost(result.comparison, venue.roundTripBps) })),
      earlierChecks: checks.map(check => ({ id: check.config.id, summary: atVenueCost(check.summary, venue.roundTripBps) })),
    })),
  },
};
await fs.writeFile(new URL('./pattern-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
log.info({ variants: results.length, checks: report.earlierChecks }, 'pattern study complete');
