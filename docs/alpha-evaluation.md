# Alpha trade evaluation

Scope: the four verticals, long calls, speculative long puts and protective puts. The
straddle and iron-fly scanners and the existing Alpha workspace remain intact.

## Contract

`POST /api/alpha/evaluate` evaluates a client quote snapshot. It never places an order,
approves margin, verifies a fill, or supplies a calibrated physical return forecast.
Business calculations belong to a pure core service; protocol owns Zod contracts, server
owns source loading, and the web adapts existing selections to the contract.

The response separates thesis alignment, selected-horizon forecast comparison, observed
stress, quote/size/cost checks, expiry payoff and optional user-distribution scenarios.
No aggregate favorable/unfavorable judgment is generated. A percentile of IV's own history
does not establish relative value. Skew sentiment is not a directional price forecast;
HMM confidence is confidence in a volatility cluster, not trade profitability.

## Calculation invariants

- Option quantities and quoted prices are normalized to underlying units before submission.
- Long-option scanners expose a minimum quantity, not an independently known quantity step.
  Their step remains unknown in this evaluator rather than being inferred from the minimum.
- Known entry fees and an explicit extra-cost reserve are required for net payoff numbers.
- Expiry scenarios use only linear settlement. Inverse settlement is explicitly unsupported
  in this evaluator; existing pricing references elsewhere retain their stated assumptions.
- User scenarios describe a lognormal terminal price with the supplied arithmetic mean
  return and annual volatility, with 365-day time. They are conditional calculations, not
  measured probabilities. Expiry payoff excludes interim liquidation and margin paths.
- Historical returns and volatility use completed, continuous daily candles. A stale or
  discontinuous history cannot supply a forecast. Reference forecasts support up to 90 days;
  the historical premium baseline remains explicitly labeled 7D or 30D and blended/venue.
- Regime, term structure and RV acceleration remain separate observations; there is no
  untested automatic regime gate or inferred event-calendar coverage.

## Prospective evidence

The user explicitly saves an immutable evaluation in this browser's IndexedDB. Original
quotes, timestamps, scenario, thesis, invalidation, model version and source context remain
attached. Actual browser save time is stored separately from evaluation time; outcomes
cannot precede either timestamp. Outcomes are separate user-reported records. They do not certify fills; an early
exit is not an expiry forecast observation. Export includes both records. Storage failures
must surface and cannot be presented as successful saves.

Future validation must use chronological holdouts, control overlapping expiry windows,
retain skipped/not-traded evaluations, include full costs, and compare each additional
regime feature against the same unconditioned baseline. A saved evaluation is not a proven
edge. No new automated trading rule is promoted by this implementation.
