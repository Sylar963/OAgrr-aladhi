# Intraday channel study

Roberto requested EMA/ATR length 130 with multiplier 4, then length 60 with multiplier 3.
Both lengths change together. The screenshot discussed is the existing repository chart.
The study tests a conventional volatility channel, independent of the current smoothed
gamma-zone chart. No 20-period variant was tested.

```bash
node --test scripts/research/intraday-channel/model.test.mjs
node scripts/research/intraday-channel/run.mjs 130 4
node scripts/research/intraday-channel/run.mjs 60 3
```

Run from the installed workspace. The runner resolves the existing core package's Zod and
Pino dependencies. It uses only public data and does not load `.env` or place orders.

## Data and timing

- Deribit BTC-PERPETUAL, five-minute OHLC, 2026-04-29 00:00 through 2026-10-26 00:00 UTC
  (end exclusive), plus five days of warmup. 51,840 evaluated bars; no missing intervals.
- [Official candle API](https://docs.deribit.com/api-reference/market-data/public-get_tradingview_chart_data).
  Cached responses live in ignored `.cache/`. The runner validates OHLC relationships,
  array lengths, exact timestamps, continuity, and complete chunks; it fails on missing data.
- Both runs use identical data, verified by the SHA-256 in each result file. Boundaries
  available during a candle use only previous completed candles. EMA uses alpha 2/(n+1);
  ATR uses Wilder alpha 1/n. Both seed with their first n-observation mean.
- The first 120 days and final 60 days are reported separately, with flat position state
  at each period start and sufficient time required for a full hold before each period end.
  The combined 180-day run has its own continuous state. Parameters were user-selected,
  and 60/3 was requested after seeing 130/4. These dates are now comparison data, not an
  untouched holdout or evidence from live forward trading.

## Fixed long-reclaim rule

1. The signal candle trades strictly below its previously known lower band and closes
   strictly inside the channel. A touch alone does not enter a trade.
2. Entry reference is the next candle's open. Freeze the prior middle as the target and
   the signal candle's low minus 0.5 prior ATR as the stop. Reject an entry already at or
   beyond either level. No trend, gamma, or reward/risk filter is applied.
3. Exit on the first target/stop hit or at the twelfth holding candle's close (60 minutes).
   An open below the stop exits at that worse open. Favorable target gaps receive only the
   target. If both stop and target are touched in one candle, charge the stop.
4. Keep one position at a time. After a signal, rearm only when a subsequent flat-state
   candle closes at or above its prior middle. Do not reenter on the rearming candle.
5. Return is the reference price change divided by entry price, in basis points. Execution
   is approximated from OHLC, not reconstructed from historical executable quotes.

The stop buffer and timeout are research assumptions, held constant between variants.
Reported drawdown is the maximum drawdown of cumulative closed-trade basis-point returns
at constant notional. It is not account drawdown, includes no compounding, and excludes
unrealized losses, leverage and liquidation. Intrabar exit times are unknown; reported
holding duration rounds up to the exit candle's end.

## Costs and statistical limits

The main comparison subtracts **9 bps per round trip**: 3.5 bps taker fees per side under
the [current standard Deribit schedule](https://support.deribit.com/hc/en-us/articles/25944746248989-Fees)
checked 2026-10-26, plus an assumed 1 bp of spread/slippage per side. This is a fixed
friction scenario, not historical account-specific charges. Also report 0/7/14 bps scenarios.
Funding, collateral costs, size-dependent market impact, option premiums and option P&L
are excluded. Cost-adjusted returns are not fully net realized trading returns.

Confidence intervals resample calendar blocks of seven days, 5,000 times with a fixed seed,
to avoid treating each touch as independent. The final 60-day slice has only nine blocks,
including a partial final block; intervals remain approximate. Multiple tested variants
and reuse of the comparison period further limit inference. The historical wall snapshots
do not contain the gamma regime and attribution needed to test gamma filters.

## Results

| Final 60 days | 130 / 4 | 60 / 3 |
| --- | ---: | ---: |
| Days with lower-band touch | 49 / 60 | 58 / 60 |
| Days with upper-band touch | 53 / 60 | 58 / 60 |
| Long-reclaim trades | 80 | 134 |
| Mean gross return, bps/trade | -1.08 | -2.21 |
| Mean after 9 bps costs, bps/trade | -10.08 | -11.21 |
| Win rate after assumed costs | 38.75% | 31.34% |
| Profit factor after assumed costs | 0.419 | 0.350 |
| Approximate 95% interval for cost-adjusted mean | [-14.79, -6.01] | [-14.52, -8.26] |

Across all 180 days, 130/4 produced 246 trades, averaging -1.79 bps gross and -10.79 bps
after assumed costs. 60/3 produced 434 trades, averaging -2.40 bps gross and -11.40 bps
after assumed costs. Lower-band touches occurred on 151 and 172 days respectively;
upper-band touches on 158 and 174 days. Touch counts include repeated interactions and
are not independent entry opportunities.

Both channels produce intraday interactions. Under these specific entry/exit assumptions,
neither unfiltered rebound strategy showed positive expectancy, even before costs. This
does not evaluate gamma-filtered breakouts, establish that the inverse trade is profitable,
or rule out other prespecified entry/exit models. New variants need fresh validation data.

Machine-readable summaries: [130/4](results-130-4.json), [60/3](results-60-3.json).
Per-trade records and the final three days of channel values are written to `.cache/`,
with filenames prefixed by the parameter pair.
