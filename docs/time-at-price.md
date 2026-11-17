# Time at Price and hourly comparisons

## Using the panel

1. Open the **Time at price** widget and choose a lookback.
2. Use the chart to inspect the price path and the price levels crossed most often.
3. Read **Hours** and **Time** beside a price range to see how many hourly candles had their
   high–low midpoint in that range and their share of all counted hours.
4. In **Hour by hour → Calendar days**, compare the same UTC hour across dates. Use the arrows
   to move by 14 days or choose a date in **Through**. The color scale stays fixed across the
   selected lookback while paging.
5. Choose **Weekday averages** to compare Monday through Sunday across the selected lookback.
   Only complete UTC days enter these averages. Focus, hover or tap a cell for its range and
   sample count.

## Definitions

| Display | Calculation | Interpretation |
| --- | --- | --- |
| Chart shade | Count of hourly low–high ranges containing each price level | A candle can cross several levels; these counts are not additive dwell times. |
| Hours / Time | Count / share of hourly high–low midpoints in the coarser price bin | All valid completed hours count, even before the trailing volatility window is available. |
| Vol 7d | Mean trailing 168-bar annualized Parkinson volatility for candles whose midpoint is in the bin | Historical volatility associated with a price range, smoothed over seven days of observations. |
| Hourly cell | `high / low - 1` | Percentage range of one completed hourly candle. |
| Day range | `dayHigh / dayLow - 1` | Range across the observed hours of that UTC date. |
| Day vol | `sqrt(mean(log(high / low)^2 / (4 * log(2))) * 8760)` | Annualized Parkinson volatility from that day's observed hours. |
| Weekday cells / mean day range | Arithmetic means across complete matching weekdays | Each weekday/hour has the same full-day sample count within its row. |
| Pooled vol | `sqrt(mean(dayVol^2))` across complete matching weekdays | Pools variance, rather than averaging standard deviations. |

Missing hours remain blank; observed zero-range hours remain zero. Calendar days show hours
observed out of 24, including partial first/last days. Partial-day statistics describe only
those observed hours. Forming/future candles are excluded, timestamps are grouped in UTC,
and duplicate hourly observations are counted once. The daily path uses each UTC day's last
observed close. The highlighted price bin uses the latest completed hourly close.

Hourly OHLC data cannot measure exact minutes spent at a price or the path taken inside a
candle. These views describe historical ranges and estimates, rather than a demonstrated
trading edge.

## Implementation and checks

The reusable aggregation lives in `packages/core/src/services/time-at-price.ts`; the shared
Zod response contract lives in `packages/protocol/src/time-at-price.ts`. The server retains
its shared maximum-lookback history cache. Web state stays in TanStack Query and validates
the response at the HTTP boundary.

The widget uses an explicit-height grid chart area so changing to a single column cannot
collapse the chart. Chart observers disconnect on unmount. Each nonzero resize first updates the canvas dimensions,
then fits the time range, including when the container becomes visible again.

Regression tests cover completed-hour filtering, duplicate and invalid candles, UTC gaps,
zero-range candles, full-history hour counts before volatility warmup, calendar paging data,
and complete-day weekday means and pooled variance. Run `pnpm precommit` for the project gate.
