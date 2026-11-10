# Alpha automatic market context

The main market-context strip answers **“Do current observed conditions support this
strategy?”** automatically. It requires no thesis, scenario inputs, selected strikes,
account equity or trade evaluation. Optional trade scenarios and the journal live behind
**V2 · Scenario lab & journal** on each of the six strategy tabs.

## Read the result

| Verdict | Meaning |
| --- | --- |
| CONDITIONS SUPPORT | The available market conditions support this structure's purpose under the rules below. This is not a profit probability or approval of any price. |
| CONDITIONAL | Conditions conflict, pricing is unresolved, or risks need qualification. The visible reasons identify which. |
| POOR FIT | A speculative strategy's direction opposes established observed price pressure. This is a market-condition conflict, not proof that a contrarian trade cannot profit. |
| INSUFFICIENT DATA | The horizon or completed price history cannot support an assessment. |

The first three reasons are visible. **Why this verdict** expands the measurements, remaining
reasons and all-strategy comparison. Calls and puts have opposing directional exposure;
credit versus debit alone does not determine a market view.

| Structure | Purpose | Support conditions |
| --- | --- | --- |
| Call credit | Bearish / range carry | Down pressure with resolved volatility pricing that is not cheap and no stress; or range with expensive volatility and no stress. |
| Put credit | Bullish / range carry | Up pressure under the same carry conditions; or range with expensive volatility and no stress. |
| Call debit | Bullish | Up pressure, fresh matched ATM IV, at least one day remaining. Rich ATM IV alone does not reject a vertical, whose legs offset part of their vega. |
| Put debit | Bearish | Down pressure under the same directional-vertical conditions. |
| Long call | Bullish / long volatility | Up pressure, 25Δ call-IV proxy below the historical delivery range, at least one day remaining. |
| Speculative long put | Bearish / long volatility | Down pressure, 25Δ put-IV proxy below that range, at least one day remaining. |
| Protective put | Insurance on owned spot | Does not require bearish pressure. Relatively cheap downside insurance supports the purpose; expensive or unresolved insurance is conditional. Actual floor and ownership matter. |

Guided Long Put is insurance; Advanced switches its main context to speculative long-put
exposure. Its table still shows bet and insurance economics side by side. Spread tabs use
the selected chain's exact expiry. Long-option scanners show an explicit **30D scanning
reference** because they list multiple expiries; that reference is not an assessment of each
candidate's expiry. Sell straddle, buy straddle and iron fly retain their existing rules.

## Measurements and explicit assumptions

1. **Price pressure, not a price forecast.** For horizons up to seven days, use completed
   hourly 6h / 24h / 7D moves when 169 continuous hourly closes are available. Otherwise use
   completed daily 1D / 7D / 30D moves. Divide each log move by 7D hourly or 30D daily RV
   scaled to the move's duration. Two windows at or above +1 unit, with none at or below −1,
   establish up pressure; reverse for down. Opposing qualifying windows mean transition.
   Other cases mean no clear trend. These overlapping windows are not independent votes.
2. **Matched horizon.** Reuse the existing volatility forecast: 7D realized variance reverts
   toward the trailing 180D variance with a 14-day half-life, averaged over the option life.
   Reuse the project's UTC-weekend variance adjustment (0.52 relative weight). This is an
   estimate, not a calibrated physical return distribution. Horizons over 90 days or past
   expiry are unavailable; under one day receive a near-expiry warning and no delivery band.
3. **Historical delivery range.** Starting after 181 daily closes, generate forecasts using
   only the history then available. Measure subsequent zero-mean close-to-close RV in
   non-overlapping `ceil(DTE)`-day outcome windows. Multiply today's forecast by the 20th
   and 80th percentiles of historical delivered/forecast ratios. Require eight outcomes.
   The UI shows the outcome count and integer window. These empirical percentiles are
   neither confidence bounds nor demonstrated future coverage. Daily windows approximate
   fractional expiries and cannot capture today's intraday jump.
4. **Current pricing.** Selected-expiry ATM IV comes automatically from active-venue ATM
   chain quotes no older than two minutes, using their mean and oldest observation time.
   Reject a future or stale timestamp. Do not substitute 7D IV for a selected 3D expiry.
   Scanner reference IV comes from a current 7D/30D observation no older than five minutes;
   intermediate reference tenors interpolate total variance. IV percentile is never used
   as a substitute for matched pricing.
5. **Wing costs.** A 25Δ proxy is `ATM + butterfly ± riskReversal/2` (plus for calls, minus
   for puts), with matching selected-chain or tenor inputs. Missing wing inputs prevent
   unconditional outright support; interpolated ATM tenors have no wing proxy. These
   are not the IVs or executable prices of a specific candidate's legs.
6. **Stress.** RV acceleration is the RV7/RV30 ratio against prior historical ratios. Flag
   ratios above one and at or above the historical 90th percentile, with at least 30 prior
   ratios. Also flag 7D IV more than two volatility points above 30D IV. Either qualifies
   aligned short-premium setups as conditional. Opposing direction still takes precedence.
7. **Data integrity.** Use only completed positive finite closes and the continuous suffix
   after the last gap. A last completed bar older than 1.5 periods is stale. Future/forming
   bars cannot change the result. A flat series supplies no pressure signal. Hourly-source
   failure can fall back to available daily history; no data produces insufficient evidence.

All numeric gates above are explicit engineering choices, not fitted or validated BTC
edges. HMM skew sentiment is not used as a directional forecast. Event-calendar coverage,
actual portfolio exposures, entry path, margin, execution, fees and precise leg economics
are outside this class-level verdict. Two parity-equivalent verticals may legitimately have
similar market fit; the system does not invent distinctions to force different scores.

## Architecture and verification

- Protocol: `AlphaStrategyContextSchema`, plus optional automatic chain observations in
  `GET /api/alpha/market-context`. Existing underlying-only consumers remain compatible.
- Core: pure `buildAlphaStrategyContext` owns calculations and ordered strategy rules.
- Server: obtains daily/hourly history independently and adds the automatic response.
- Web: submits current chain observations automatically, refreshes every 30 seconds,
  presents verdicts/reasons, and isolates manual evaluation behind the optional V2 switch.

Regression fixtures cover direction conflicts despite cheap IV, debit versus outright
volatility exposure, put-skew costs, insurance, reversals, acceleration, selected-expiry
matching, freshness, gaps, missing history, unsupported horizons and exclusion of future
bars. They verify implementation behavior, not trading performance. A future validation
study must use point-in-time quotes and costs with chronological holdout periods before
any edge or probability claims.

Reviewed primary sources: [OIC bull call spread](https://www.optionseducation.org/strategies/all-strategies/bull-call-spread-debit-call-spread),
[CME bull spread](https://www.cmegroup.com/education/courses/option-strategies/bull-spread),
and [Cboe portfolio protection](https://www.cboe.com/insights/posts/how-to-protect-your-portfolio-during-market-uncertainty).
These support payoff/exposure distinctions, not the numeric gates or a BTC edge.
