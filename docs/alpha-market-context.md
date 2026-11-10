# Alpha automatic market context

Alpha now shows compact premium color signals, with detailed measurements available on demand.
The builder, original strategy tabs, venue alternatives and scanners remain available.

## Read the pricing signals

| Signal | Meaning |
| --- | --- |
| IV price / IV − RV ref | Selected-expiry ATM IV versus the same-horizon RV estimate. Cheap/rich uses the existing ±2-point display band; high absolute IV can still be relatively cheap. |
| Above usual premium | IV − matched RV estimate − the usual IV/RV premium from the 7D or 30D baseline. That baseline is a labeled tenor proxy. Missing history stays unavailable. |
| Vol stress | Existing acceleration/backwardation flags, displayed separately from price. |
| Long leg dollar saving / sold leg dollar richness | Actual ask plus standalone fees/reserve versus reference long value, or actual bid minus standalone fee versus reference short value. |
| Spread dollar advantage | Reference value minus all-in debit, or net credit minus reference liability, at the selected strikes and size. A leg's good price does not guarantee a good spread price. |
| Single option | The same long option for debit spreads; a same-direction long put/call at the short strike for call/put credits. Different credit and outright payoffs are explicitly labeled. |

Green means that individual price condition is met; red means unmet, amber mixed/near
reference, and gray unavailable. None is a direction forecast or a trade approval.
The dollar checks use flat matched forecast volatility, current venue forwards and zero
rates in Black-76. They include bid/ask, known entry fees and the manual cost reserve.
They withhold comparisons for inverse settlement, cross-venue pairs, stale or missing
quotes, or a wrong-expiry/asset/stale reference. They do not change scanner ranking or execution.
See [the reading and calculation ledger](knowledge/options-trading.md#alpha-dollar-premiums-and-spread-versus-single-option-2026-11-10)
for formulas, assumptions, source pages and tests.

**Compare costs** opens the spread/standalone dollar table, sold-wing value, actual funding
percentage, cap strike and expiry crossover. It does not assume the cap fits a user's target.
**Volatility details** opens historical delivery, wing-IV proxies, own-IV history, usual
premium, implied move, range and acceleration. **Account balances** and **V2 · Scenario lab
& journal** are collapsed by default. All of these and the trade controls share a single
vertical scroll area, so expanding a panel cannot trap the builder below an unscrollable header.

Long-option scanners label the strip as a **30D reference**, because their candidates span
multiple expiries. Sell/buy straddle and iron-fly scanner setup rules are preserved.
The API still returns its previous directional `assessments` for compatibility; the UI no
longer presents that verdict, its reasons, or the all-strategy comparison table.

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
  presents compact pricing colors and dollar comparisons, and isolates manual evaluation behind the optional V2 switch.

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

## Compact pricing UI validation (2026-11-10)

- `VITEST_MAX_WORKERS=1 npm_config_workspace_concurrency=1 pnpm precommit`: passed,
  4,643 tests across 569 files; final focused pricing/context/workspace checks: 39 passed.
- Web typecheck and production build passed. The final frontend bundle is installed locally;
  `ogg-backend.service` was restarted and returned healthy.
- Chromium verified all Alpha tabs, collapsed defaults, expanding optional panels, editing
  sizing after expansion, and scrolling to the bottom at 1200px, 768px and 390px widths.
  No document overflow or browser page errors. At 1550×820, the content scroll area retained
  626px height while expanded panels increased scrollable content from 4548px to 4955px.
- A live linear put-debit example showed a positive long-leg saving alongside a negative
  net-spread difference. Deterministic tests cover all four verticals and credit green gates.
  Browser checks validate UI behavior and displayed arithmetic, not fillability or performance.
