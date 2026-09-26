# Shared options-trading knowledge

Last reviewed: 2026-09-26. Purpose: persistent project context for Roberto and future agents.
This is a selective, source-linked research notebook, not a claim that all books have been
read, a trained model, a validated trading system, or personalized investment advice.

## Start here

1. Read the source ledger and principles below before changing Alpha or Portfolio.
2. Separate **book principle**, **BTC interpretation**, **engineering derivation**, and
   **empirical evidence**. An appealing idea is not a demonstrated edge.
3. Preserve the existing Alpha layout. Put small explanations and comparisons beside the
   existing controls; do not replace the workspace.
4. For a new financial claim, record the exact source, assumptions, costs, invalidation,
   and a test. Verify current exchange rules from official documentation.
5. Update this notebook when reading new sections or collecting evidence. Never promote
   a hypothesis to a validated strategy based on one profitable trade.

## Source and reading ledger

Page numbers below are printed pages unless explicitly called PDF pages. Notes are paraphrases.

| Source | Reviewed material | Status / limits |
| --- | --- | --- |
| [Sinclair, Volatility Trading](../Volatility+Trading+-+Euan+Sinclair.pdf) | Introduction pp. 1, 3; rich-for-a-reason pp. 15–16; forecasting pp. 32–33, 39–44 (vol cone, implied premium), 47, 52–54 (events); hedging/tails pp. 78, 85, 87–99; money management pp. 101, 109, 118–126; trade evaluation pp. 128–129; psychology pp. 152–154, 156–157, 161–162; examples pp. 168–175; contents | Selective reading. In this file printed page +13 gives the 1-based PDF page. Short-vol passages were added 2026-09-26 from text extraction and spot-checked (pp. 39–43, 97). Estimator details pp. 17–31 and parts of the Kelly derivation were NOT read. |
| [Bennett, Trading Volatility](../Colin_Bennett_Trading_Volatility_Trading_Volatility,_Correlation.pdf) | Contents; introductory/executive material; option trading pp. 10–13, 20, 24, 30; option structures p. 32; hedging p. 41; term structure pp. 49–50, 138–146; volatility overpricing pp. 84–85; events pp. 124–125; hedging noise pp. 128–135 | Equity-focused historical observations, not BTC findings. Printed page +1 gives PDF page. Extraction failed on PDF pp. 34 and 39; formulas are garbled on PDF pp. 126–127 and 147. Do not infer their text. Variance-swap and exotics chapters were not read. |
| [Casanovas, Opciones financieras, 7th ed.](../Casanovas_Ramón,_Montserrat_Opciones_financieras_7a_ed_Larousse.pdf) | Contents; §5.2.1 pp. 113–116, 118–120 | Reviewed definitions and bull/bear vertical payoffs. PDF and printed pages match in this section. Historical Spanish market/legal material is not current exchange guidance. |
| [Natenberg, Option Volatility & Pricing](../Sheldon_Natenberg_Option_Volatility_&_Pricing_Advanced_Trading_Strategies.pdf) | None | File is **0 bytes**. Needs re-upload. Do not attribute learning to it. |
| [PDF_AuctionPricing](../PDF_AuctionPricing.pdf) | File checked, six pages; first four have no extractable text | Not studied. Needs rendering/OCR before substantive attribution. Title/author not verified. |

## Principles we carry into the product

| ID | Book principle and source | BTC interpretation / product rule |
| --- | --- | --- |
| K1 | Sinclair p. 3 treats opportunity selection, bankroll/risk management, and psychology as complementary tasks. | An opportunity row needs price/cost evidence, actual-sized risk, and a review plan. None substitutes for the others. |
| K2 | Sinclair p. 101: sizing can spoil good trades; money management does not create an edge in a bad strategy. | A trade fitting a 1% example budget is **not** a buy/sell recommendation. Show budget fit and model EV separately. |
| K3 | Sinclair pp. 32–33 distinguishes measured historical volatility from forecasting future volatility, especially after unusual events. | IV minus trailing RV is descriptive context. Match forecast horizon to expiry; do not treat past 30D RV as a reliable next-four-day forecast. |
| K4 | Sinclair p. 40 discusses short-window sampling uncertainty and overlapping observations. | Backtests must avoid overstated sample counts and look-ahead. Overlapping expiry outcomes are not independent bets. |
| K5 | Sinclair pp. 88–89: discrete hedging makes results path-dependent; timing matters even at the same realized volatility. | An expiry payoff picture is not a liquidation guarantee or a hedge P&L forecast. Distinguish terminal payoff, mark-to-market, and margin paths. |
| K6 | Sinclair pp. 128–129 emphasizes review and attribution of results net of costs, not just total P&L. | Journal the thesis, quoted vs filled price, fees, entry/exit time, realized outcome, and why the trade worked or failed. |
| K7 | Sinclair pp. 153–154, 161–162 discusses overconfidence, confirmation, hindsight, and anchoring. | Intelligence/confidence is not evidence. Write forecasts before looking for confirming prices, preserve losing evidence, and do not raise size to recover losses. |
| K8 | Bennett pp. 10–13: strategy, strike, expiry, direction, volatility, and liquidity interact. | “Buy” versus “sell” is not the first question. Start with a market thesis, horizon, affordable loss, and executable venue quotes. |
| K9 | Bennett p. 32: selling a farther call can reduce a long call's cost while giving up part of the upside. | A debit spread is cheaper than its outright long leg, not free. Compare capped payoff with the expected move and full execution cost. |
| K10 | Bennett pp. 84–85 discusses risk exposure and structural demand behind equity volatility premia, and cautions against extrapolating historical profitability. | Selling premium can be compensation for unpleasant risks. Test BTC-specific data; never import an equity VRP claim as a BTC guarantee. |
| K12 | Sinclair pp. 87, 95–96: a hedged short straddle earns roughly vega × (implied − realized), and only on average. | Judge a straddle on IV versus a realized forecast over the **same horizon** as its expiry, using the IV implied by the executable bid credit after fees, not mark IV. |
| K13 | Sinclair pp. 41–43: implied usually exceeds forecast because it carries an insurance premium. That premium alone is not a good enough reason to sell. | Subtract the usual implied-minus-subsequent-realized spread before calling IV rich. With too little history, that baseline is unknown, not zero. |
| K14 | Sinclair pp. 39–41: a vol cone gives the realized range per horizon. Selling IV in the 90th percentile of the cone is a sensible plan; selling because one point forecast is lower is not. | Rank IV within BTC's historical realized vols for the same window. Below the median is cheap. The gate uses p75 (our choice, not the book's 90th). |
| K15 | Sinclair pp. 15–16, 175; Bennett pp. 30, 138–139: rich vol can be rich for a reason, and inverted term structure marks turbulent regimes. | Backwardation, a spot breakout, or accelerating realized vol downgrade a rich straddle to watch. They are not auto-sells. |
| K16 | Sinclair pp. 78, 85, 92–93, 152: the path can lose even when the vol call is right; jumps defeat hedging; short vol looks like slight positive expectancy with extreme downside. | Short straddles have unbounded loss. Show a stress scenario and size to it. Never present stress loss as a maximum. |
| K17 | Sinclair p. 97: short-straddle P&L concentrates near the strike, an argument for strangles. | Keep strangles and wings as the next research item. Do not treat the ATM straddle as the only short-vol expression. |
| K18 | Sinclair pp. 109, 118–126: full Kelly has about a 1/3 chance of halving before doubling. Understate edge and size below full Kelly. | Size from a user-set stress budget, capped by top-of-book. A fitted size is not a recommendation to trade. |
| K11 | Casanovas pp. 113–120 defines vertical/calendar/diagonal spreads and bullish/bearish structures. | “Spread” does not mean cross-venue. A same-expiry vertical uses different strikes of the same right and underlying; use both legs on one venue for the current Alpha comparison. |

## Credit versus debit: payoff map

The following is an engineering derivation for equal-size, same-expiry, linear cash-settled
European verticals. It is not a prediction. Let lower strike be L, higher strike H, W=H−L,
q be quantity in underlying units, C be positive gross credit, D positive gross debit,
and F include entry fees plus the explicitly entered extra-cost reserve (all cash amounts
are for q, not per contract). Actual settlement/closing costs can differ from that reserve.

| Structure | Legs | Direction at expiry | Maximum expiry profit | Maximum expiry loss | Breakeven |
| --- | --- | --- | --- | --- | --- |
| Call credit | Sell L call, buy H call | Bearish | C−F | qW−C+F | L+(C−F)/q |
| Put credit | Sell H put, buy L put | Bullish | C−F | qW−C+F | H−(C−F)/q |
| Call debit | Buy L call, sell H call | Bullish | qW−D−F | D+F | L+(D+F)/q |
| Put debit | Buy H put, sell L put | Bearish | qW−D−F | D+F | H−(D+F)/q |

The entry should have a positive possible payoff after estimated costs; missing fees are
unknown, not zero. Bounds assume the equal-size legs are both filled and retained together.
They exclude exchange default, collateral depeg, forced liquidation, unmatched execution,
and costs exceeding the reserve. Inverse-settled contracts need a different risk model.

Required test invariants:

- P&L at breakeven is approximately zero.
- Terminal P&L never exceeds the stated profit/loss bounds under the stated assumptions.
- Maximum profit + maximum loss = q × strike width.
- Credit/debit reversals cross different sides of the market. Do not negate a credit EV
  to obtain the executable debit EV.
- Test non-unit size, fees, minimum quantity, both leg increments, displayed size, expiry,
  timestamps, absent fields, settlement, and venue identity.
- Do not rank a cross-venue synthetic as an executable same-venue opportunity.

## Short ATM straddle: model and gates (Sell Straddle tab)

Engineering derivation, per 1 underlying unit, same venue, same strike K and expiry, linear
cash-settled European options. Net credit N = call bid + put bid − taker fees at the bids.
Terminal P&L = N − |S_T − K|. Breakevens are K ± N. Loss is unbounded on the upside and
reaches K − N on the downside.

`packages/server/src/alpha-straddle-scanner.ts` (route `/api/alpha/straddle-scanner`) evaluates
the listed strike nearest the venue forward for each venue and expiry in the DTE window:

- **Sell IV:** the Black-76 vol at which the straddle is worth N (bids, after fees).
- **Forecast (v1):** 7D realized variance decays toward realized variance over up to 180D,
  with a 14-day half-life, averaged over the option's life. The half-life is an unfitted
  assumption, and the model has no events or jumps.
- **Hurdle:** the maximum of the forecast and realized vol over the last DTE days.
- **Cheap (do not sell):** sell IV ≤ hurdle, OR net credit ≤ Black-76 value at the forecast,
  OR sell IV below the median of the same-horizon vol cone (K12–K14).
- **Watch:** below cone p75; excess over the usual premium ≤ 0 or unknown (7D ATM IV history
  for DTE ≤ 14, 30D otherwise; needs 4 independent windows); backwardation; spot breakout;
  7D RV > 1.25 × 30D RV; under 2 DTE; or size below the venue minimum (K15).
- **Usual premium source:** the venue's own constant-maturity ATM IV history
  (`venue_iv_history_points`, hourly since 2026-09-26, built only from that venue's quotes and
  only when its expiries bracket the tenor) once it has 4 independent windows. Until then the
  cross-venue history (`iv_history_points`; 30D seeded from Deribit DVOL) is used, and the
  response marks `premiumBaseline.source` as `venue` or `blended`. Venue IVs differ by a few
  points, so a blended baseline can make one venue look rich or cheap for a structural reason.
  Realized vol in both baselines comes from Deribit BTC-PERPETUAL daily closes (08:00 UTC).
- **Sizing:** quantity whose loss at ±kσ (default 3σ at the higher of sell IV and hurdle)
  fits equity × stress budget %, capped by min(call bid size, put bid size).
- **Ranking:** verdict, then model edge ÷ stress loss.

The 1.25, p75, 14-day, and 2-DTE thresholds are our choices. They are not sourced rules and
are untested on BTC. The existing walk-forward evaluator (`short-straddle-evaluator.ts`)
records ATM ~7D straddles sold at bids and bought back at asks after fees. The tab shows it
as evidence, which remains inconclusive until the per-horizon confidence interval excludes
zero. On 2026-09-26 the live scan rated every BTC straddle "cheap": sell IV was 31–34%
against a forecast of about 37%, with 30D IV at p7.

## What Alpha knows, and what it does not

The sized card and per-venue alternatives use `features/alpha/spread-scanner.ts`.
The original leg tables and smile remain available. The old `verticalSpread.ts` analysis
still supports the original routing diagnostic API and its tests; its 10%/20% ROC heuristic
is **not** used as the sized card's decision threshold.

The reference model uses the mean of the two legs' venue forward inputs and mean mark IV,
with one flat-IV lognormal terminal distribution for both legs. Model EV is signed entry
cash less costs plus expected net intrinsic payoff. This is a simplified risk-neutral
pricing comparison, not a physical forecast. It omits smile dynamics, jumps, and model
parameter uncertainty. Positive model EV may be a model artifact.

Alpha currently shows:

- Call/put credit and debit controls in the original builder.
- Manual equity, quantity, loss budget, and extra-cost reserve; these are not live account
  balances or approved margin. Default 1% / $0.25 are editable examples, not sourced rules.
- Selected-strike quotes and up to three ranked alternatives per active venue, for the
  selected expiry and strategy. Not an exhaustive cross-expiry optimizer.
- Entry bid/ask pricing, known normalized entry fees, quote/size eligibility, and exclusions.
- Size-adjusted payoff, breakeven, model EV, risk-neutral probability, and expiry scenarios.
- Read-only connected portfolio context. Candidate risk is not combined margin approval.
- Sell Straddle tab: cross-expiry ATM short-straddle scan with the cheap-premium gates above,
  a stress-sized quantity, and walk-forward evidence. Scan only; no orders.

Missing/unfinished research: calibrated physical return distributions, forecast errors,
event-aware BTC volatility, out-of-sample execution-cost studies, portfolio incremental
Greeks and margin, and a persistent filled-trade attribution journal. Do not imply these
exist because a reference-model EV is displayed.

## Thalex execution assumptions

Official fee rules checked on 2026-09-18:
[Thalex trading fees](https://support.thalex.com/hc/en-us/articles/7079268315665-What-trading-fees-does-Thalex-charge)
states that option-combo fees apply to the highest-fee leg, with a minimum trade fee.
The scanner applies that combo assumption and labels it. Separate leg orders do not
have the same fee treatment or atomicity. Public tier assumptions are not an account's
verified fee tier.

[Thalex combo order behavior](https://support.thalex.com/hc/en-us/articles/35274930686097-How-do-I-Place-Buy-Sell-Orders-and-What-Types-are-Supported)
describes net combo orders and outright-book execution. Our screen combines synchronized
outright quotes; it does not obtain an executable combo commitment or submit an order.
Check actual venue margin, fee tier, settlement costs, and order confirmation.

## Short trading review

This is our workflow adaptation, not a verbatim book rule or medical guidance.

1. **Thesis:** “By [expiry], I expect [range/direction/volatility], because [evidence].
   I am wrong if [invalidation].” Record the forecast before selecting an attractive quote.
2. **Risk:** State actual quantity, maximum expiry loss, percent of current equity,
   costs, free margin, and existing correlated exposure. If any required field is unknown,
   stop at research rather than treating it as a zero.
3. **Plan:** State entry price, exit condition, time limit, and review time. Record actual
   fills and outcomes afterward. No requirement to trade every session.

Do not confuse:

- High win rate with positive expectancy.
- Premium received with income earned.
- A profitable outcome with proof of skill, or a losing outcome with low intelligence.
- Positive theta with guaranteed daily cash.
- A bounded expiry payoff with bounded intraday margin needs.
- A price difference across venues with frictionless arbitrage.

## Research queue and evidence requirements

1. Short vol: fit the forecast half-life and gate thresholds out-of-sample on BTC; add
   strangles/wings (K17), an event-implied move from the front two expiries (Sinclair
   pp. 52–54). 30D baselines became measurable on 2026-09-26 (DVOL seed + stored history);
   per-venue baselines need ~4 months of hourly venue history before they replace the blend.
2. Re-upload Natenberg; render/OCR the auction document. Read the remaining targeted chapters
   on Greeks, skew, hedging costs, and forecast distributions; extend the source ledger.
3. Study matched-horizon BTC volatility forecasts. Compare IV, trailing RV, simple forecasts,
   and event-aware alternatives on rolling out-of-sample periods. Avoid future leakage.
4. Evaluate each strategy at contemporaneous bid/ask, fees, and tradable sizes. Record stale
   and absent quotes. Do not silently fill at marks or assumed midpoints.
5. Stress plausible BTC price jumps, IV/skew changes, and portfolio concentration separately
   from terminal payoff. Verify venue-specific collateral and margin rules.
6. Track net expectancy, average win/loss, drawdown, tail loss, fill rate, turnover, and
   forecast calibration. Account for overlapping positions and uncertainty intervals.
7. Only call an edge empirically supported after reproducible out-of-sample evidence and
   realistic execution assumptions. There is currently **no validated profitable BTC
   options strategy documented here**.

For each future finding append:

```text
Date / source / printed and PDF pages:
Principle:
Assumptions and counterexample:
BTC-specific hypothesis:
Required data and costs:
Test and out-of-sample result:
Status: reading note | hypothesis | tested finding | invalidated
Implementation / regression test:
```
