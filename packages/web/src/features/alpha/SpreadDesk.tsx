import { useEffect, useMemo, useRef, useState } from 'react';
import { VENUE_IDS, type VenueId } from '@oggregator/protocol';
import { useChainQuery, useExpiries } from '@features/chain';
import { AlphaPortfolioContext } from '@features/portfolio';
import { VENUES } from '@lib/venue-meta';
import {
  scanSpreads,
  expiryPnl,
  VERTICAL_LABELS,
  type SpreadCandidate,
  type VerticalKind,
} from './spread-scanner';
import styles from './SpreadDesk.module.css';

const money = (n: number | null) =>
  n == null || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const price = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const labels = {
  review: 'Review assumptions',
  'no-edge': 'No model edge',
  'over-budget': 'Over budget',
  'no-model': 'Model unavailable',
};

function usePlanningInput(key: string, fallback: string) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem('alpha-plan:' + key);
      return saved != null && Number.isFinite(Number(saved)) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('alpha-plan:' + key, value);
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

export default function SpreadDesk({ underlying }: { underlying: string }) {
  const [venue, setVenue] = useState<VenueId | 'all'>('thalex');
  const [expiryChoice, setExpiry] = useState('');
  const [equity, setEquity] = usePlanningInput('equity', '');
  const [risk, setRisk] = usePlanningInput('risk', '1');
  const [quantity, setQuantity] = useState(underlying === 'ETH' ? '0.1' : '0.01');
  const [reserve, setReserve] = usePlanningInput('reserve', '0.25');
  const [kind, setKind] = useState<VerticalKind | 'all'>('all');
  const [withinBudget, setWithinBudget] = useState(true);
  const [visibleRows, setVisibleRows] = useState(12);
  const [forecast, setForecast] = useState(false);
  const [move, setMove] = useState('0');
  const [vol, setVol] = useState('40');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const { data: expiryData, isError: expiryError } = useExpiries(underlying);
  const expiries =
    venue === 'all'
      ? (expiryData?.expiries ?? [])
      : (expiryData?.byVenue.find((v) => v.venue === venue)?.expiries ?? []);
  const expiry = expiries.includes(expiryChoice)
    ? expiryChoice
    : (expiries.find((e) => Date.parse(e + 'T08:00:00Z') - now >= 4 * 86_400_000) ??
      expiries[0] ??
      '');
  const venues = useMemo(() => (venue === 'all' ? [...VENUE_IDS] : [venue]), [venue]);
  const chain = useChainQuery(underlying, expiry, venues, { refetchInterval: 5_000 });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setQuantity(underlying === 'ETH' ? '0.1' : '0.01');
    setSelectedId(null);
  }, [underlying]);
  const valid =
    Number(equity) > 0 &&
    Number(risk) > 0 &&
    Number(risk) <= 100 &&
    Number(quantity) > 0 &&
    reserve !== '' &&
    Number(reserve) >= 0 &&
    (!forecast || (move !== '' && Number(move) > -100 && Number(vol) > 0));
  const scans = useMemo(
    () =>
      chain.data && !chain.isError && valid
        ? scanSpreads({
            chain: chain.data,
            venues,
            quantity: Number(quantity),
            equity: Number(equity),
            riskPct: Number(risk),
            costReserve: Number(reserve),
            nowMs: Date.now(),
            ...(forecast
              ? { forecast: { movePct: Number(move), volatility: Number(vol) / 100 } }
              : {}),
          })
        : [],
    [
      chain.data,
      chain.isError,
      venues,
      quantity,
      equity,
      risk,
      reserve,
      now,
      forecast,
      move,
      vol,
      valid,
    ],
  );
  const filtered = scans.map((scan) => ({
    ...scan,
    candidates: scan.candidates.filter(
      (c) => (kind === 'all' || c.kind === kind) && (!withinBudget || c.status !== 'over-budget'),
    ),
  }));
  const candidates = filtered.flatMap((s) => s.candidates);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  const positive = candidates.filter((c) => c.status === 'review').length;
  const spot = chain.data?.stats.indexPriceUsd ?? null;
  return (
    <div className={styles.desk}>
      <header className={styles.intro}>
        <div>
          <span className={styles.eyebrow}>01 / DEFINE THE TRADE</span>
          <h1>Find a spread that fits.</h1>
          <p>One venue. Both legs. Risk shown for your actual size.</p>
        </div>
        <div className={styles.budget}>
          <span>YOUR LOSS BUDGET / TRADE</span>
          <strong>
            {valid ? money((Number(equity) * Number(risk)) / 100) : 'Set equity below'}
          </strong>
          <small>Manual planning balance · not free margin</small>
        </div>
      </header>
      <section className={styles.controls} aria-label="Spread scan settings">
        <label>
          Execution venue
          <select
            value={venue}
            onChange={(e) => {
              setVenue(e.target.value as VenueId | 'all');
              setSelectedId(null);
            }}
          >
            <option value="all">Compare each venue</option>
            {VENUE_IDS.map((v) => (
              <option key={v} value={v}>
                {VENUES[v]?.label ?? v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expiry
          <select
            value={expiry}
            onChange={(e) => {
              setExpiry(e.target.value);
              setSelectedId(null);
            }}
          >
            {expiries.length === 0 && <option value="">No listed expiry</option>}
            {expiries.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          Account equity · USD
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter current equity"
            value={equity}
            onChange={(e) => setEquity(e.target.value)}
          />
        </label>
        <label>
          Risk budget · %
          <input
            type="number"
            min="0.01"
            max="100"
            step="0.25"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
          />
        </label>
        <label>
          Size per leg · {underlying}
          <input
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label>
          Extra cost reserve · USD
          <input
            type="number"
            min="0"
            step="0.05"
            value={reserve}
            onChange={(e) => setReserve(e.target.value)}
          />
        </label>
      </section>
      <p className={styles.note}>
        Equity, risk and reserve are remembered on this browser; update equity before each session.
        Entry fees use public estimates. The extra reserve allows for settlement, exit fees or
        slippage; it is not a verified fee cap. Expiry payoff risk is not the exchange margin
        requirement.
      </p>
      <details className={styles.assumptions}>
        <summary>Model assumptions · {forecast ? 'Your forecast' : 'Market benchmark'}</summary>
        <p>
          The market benchmark uses this venue’s forward and the mean mark IV of the two legs in a
          flat-volatility lognormal model. It is a price comparison, not a prediction. A positive
          difference is a review candidate, not a buy/sell instruction.
        </p>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={forecast}
            onChange={(e) => setForecast(e.target.checked)}
          />{' '}
          Evaluate my expiry forecast
        </label>
        {forecast && (
          <div className={styles.forecast}>
            <label>
              Expected mean price move by expiry · %
              <input
                type="number"
                step="0.5"
                min="-99"
                value={move}
                onChange={(e) => setMove(e.target.value)}
              />
            </label>
            <label>
              Forecast annual volatility · %
              <input
                type="number"
                min="0.1"
                step="1"
                value={vol}
                onChange={(e) => setVol(e.target.value)}
              />
            </label>
            <p>
              Scenario EV depends entirely on these assumptions. Changing them does not establish an
              edge. Fat tails, volatility changes and forecast error are not modeled.
            </p>
          </div>
        )}
      </details>
      <section className={styles.results} aria-label="Same-venue spread candidates">
        <div className={styles.resultHeader}>
          <div>
            <span className={styles.eyebrow}>02 / COMPARE CANDIDATES</span>
            <h2>
              {!valid
                ? 'Set your account budget to scan'
                : chain.isError || expiryError
                  ? 'Market data unavailable'
                  : chain.isLoading
                    ? 'Loading venue quotes'
                    : !expiry
                      ? 'No listed expiry on this venue'
                      : scans.every((scan) => scan.candidates.length === 0)
                        ? 'No eligible quotes at this size'
                        : positive > 0
                          ? positive + ' candidates to investigate'
                          : 'No positive model edge within budget'}
            </h2>
            <p>
              {expiry || 'Choose an expiry'} · All strike pairs in this expiry · Refreshes every 5
              seconds
            </p>
          </div>
          <div className={styles.filters}>
            <label>
              Structure
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as VerticalKind | 'all')}
              >
                <option value="all">All four verticals</option>
                {Object.entries(VERTICAL_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={withinBudget}
                onChange={(e) => setWithinBudget(e.target.checked)}
              />{' '}
              Within budget only
            </label>
          </div>
        </div>
        {(chain.isError || expiryError) && (
          <p role="alert">
            Market data unavailable. Refresh or choose another venue; no cached quote is presented
            as current.
          </p>
        )}
        {chain.isLoading && <p role="status">Loading venue quotes…</p>}
        {!valid && (
          <p>
            Enter positive equity, risk and quantity, plus a nonnegative cost reserve. These fields
            size the analysis; they do not submit an order.
          </p>
        )}
        {filtered.map((scan) => (
          <div key={scan.venue} className={styles.venueGroup}>
            <div className={styles.venueHeading}>
              <h3>{VENUES[scan.venue]?.label ?? scan.venue}</h3>
              <span>
                {scan.candidates.length} matches · ranked by budget, then model difference in USD
              </span>
            </div>
            {scan.candidates.length > 0 ? (
              <div className={styles.tableScroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Structure / bias</th>
                      <th>Buy / sell strike</th>
                      <th>Max gain*</th>
                      <th>Max loss*</th>
                      <th>Equity risk</th>
                      <th>{forecast ? 'Scenario EV*' : 'Model difference*'}</th>
                      <th>Assessment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.candidates.slice(0, visibleRows).map((c) => (
                      <tr key={c.id} data-selected={selectedId === c.id}>
                        <td>
                          <button
                            type="button"
                            aria-pressed={selectedId === c.id}
                            onClick={() => setSelectedId(c.id)}
                          >
                            {VERTICAL_LABELS[c.kind]} <span>↗</span>
                          </button>
                          <small>
                            {c.direction} · {c.quantity} {underlying}
                          </small>
                        </td>
                        <td>
                          {price(c.buyStrike)} / {price(c.sellStrike)}
                        </td>
                        <td className={styles.profit}>{money(c.maxProfit)}</td>
                        <td className={styles.loss}>{money(c.maxLoss)}</td>
                        <td>{c.riskPct.toFixed(2)}%</td>
                        <td>{money(c.modelEdge)}</td>
                        <td>
                          <span className={styles.badge} data-status={c.status}>
                            {labels[c.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {scan.rejected['Enter valid sizing and an unexpired expiry']
                  ? 'This expiry has settled or inputs are invalid.'
                  : scan.candidates.length === 0 &&
                      scan.rejected &&
                      scans.find((s) => s.venue === scan.venue)?.candidates.length
                    ? 'No spreads match the structure and risk filters. Adjust size or inspect over-budget candidates.'
                    : 'No eligible pairs at this size and expiry.'}
              </p>
            )}
            {scan.candidates.length > visibleRows && (
              <button
                className={styles.more}
                type="button"
                onClick={() => setVisibleRows((count) => count + 12)}
              >
                Show 12 more {VENUES[scan.venue]?.label ?? scan.venue} spreads
              </button>
            )}
            <details className={styles.diagnostics}>
              <summary>
                Quote checks and exclusions
                {scan.candidates.length > visibleRows
                  ? ' · showing top ' + visibleRows + ' matches'
                  : ''}
              </summary>
              {Object.entries(scan.rejected).map(([reason, count]) => (
                <p key={reason}>
                  {reason}: {count} pairs
                </p>
              ))}
              <p>
                Requires known fees, matching linear settlement, valid minimum/step, sufficient
                displayed size, quotes ≤15s old and timestamps ≤2s apart. Exclusion counts show the
                first failed check per pair. Same venue alone does not guarantee atomic execution.
              </p>
            </details>
          </div>
        ))}
        <p className={styles.note}>
          * Position dollars after estimated entry fees and your cost reserve. No trade is a valid
          result. A better rank does not mean positive expected profit. Inverse-settled contracts
          are excluded because their collateral risk needs a separate model.
        </p>
      </section>
      {selectedId && !selected && (
        <p role="status" className={styles.note}>
          The selected spread no longer passes the current quote checks or filters. Select a current
          candidate.
        </p>
      )}
      {selected && <SpreadReview candidate={selected} spot={spot} underlying={underlying} />}
      {venue !== 'all' && <AlphaPortfolioContext venue={venue} underlying={underlying} />}
      <details className={styles.assumptions}>
        <summary>Credit or debit? A quick reference</summary>
        <div className={styles.education}>
          <p>
            <strong>Put credit · bullish</strong>
            <br />
            Sell the higher put, buy the lower put. Profit if price stays high enough.
          </p>
          <p>
            <strong>Call debit · bullish</strong>
            <br />
            Buy the lower call, sell the higher call. Pay for upside with a capped gain.
          </p>
          <p>
            <strong>Call credit · bearish</strong>
            <br />
            Sell the lower call, buy the higher call. Profit if price stays low enough.
          </p>
          <p>
            <strong>Put debit · bearish</strong>
            <br />
            Buy the higher put, sell the lower put. Pay for downside with a capped gain.
          </p>
        </div>
        <p>
          High win probability is not the same as good value. Buying is not automatically attractive
          when selling looks unfavorable. Both sides pay trading costs.
        </p>
      </details>
    </div>
  );
}

function SpreadReview({
  candidate: c,
  spot,
  underlying,
}: {
  candidate: SpreadCandidate;
  spot: number | null;
  underlying: string;
}) {
  const panel = useRef<HTMLElement>(null);
  const [thesis, setThesis] = useState('');
  const [exit, setExit] = useState('');
  const [checks, setChecks] = useState(false);
  useEffect(() => {
    setChecks(false);
    setThesis('');
    setExit('');
  }, [c.id]);
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [c.id]);
  return (
    <section ref={panel} className={styles.review} aria-label="Selected spread review">
      <span className={styles.eyebrow}>03 / REVIEW BEFORE EXECUTION</span>
      <h2>
        {VERTICAL_LABELS[c.kind]} · {VENUES[c.venue]?.label ?? c.venue} · {c.expiry}
      </h2>
      <div className={styles.legs}>
        <p>
          <span>
            BUY {c.quantity} {underlying}
          </span>
          <strong>{c.buySymbol}</strong>
        </p>
        <p>
          <span>
            SELL {c.quantity} {underlying}
          </span>
          <strong>{c.sellSymbol}</strong>
        </p>
      </div>
      <div className={styles.reviewStats}>
        <div>
          <span>Gross {c.grossPremium > 0 ? 'credit' : 'debit'}</span>
          <strong>{money(Math.abs(c.grossPremium))}</strong>
        </div>
        <div>
          <span>Estimated entry fee</span>
          <strong>{money(c.entryFee)}</strong>
        </div>
        <div>
          <span>Extra cost reserve</span>
          <strong>{money(c.costReserve)}</strong>
        </div>
        <div>
          <span>Expiry breakeven*</span>
          <strong>{money(c.breakeven)}</strong>
        </div>
        <div>
          <span>Model probability of profit*</span>
          <strong>{c.probability == null ? '—' : (c.probability * 100).toFixed(1) + '%'}</strong>
        </div>
        <div>
          <span>Immediate round-trip estimate</span>
          <strong>{money(c.roundTrip)}</strong>
        </div>
      </div>
      <p className={styles.note}>
        {c.model === 'market'
          ? 'Probability is risk-neutral under a flat-IV approximation.'
          : 'Probability and EV use your forecast distribution.'}{' '}
        * Includes the chosen reserve. Round-trip estimate uses reverse bid/ask quotes and estimated
        fees, excludes the reserve, and is not a guaranteed exit fill. Quote age{' '}
        {(c.ageMs / 1000).toFixed(1)}s · displayed entry capacity {c.capacity} {underlying}.
      </p>
      {spot != null && spot > 0 && (
        <div className={styles.scenarios}>
          <span>Expiry payoff at a given settlement price</span>
          <div>
            {[-10, -5, 0, 5, 10].map((pct) => (
              <div key={pct}>
                <small>
                  {pct > 0 ? '+' : ''}
                  {pct}% · {price(spot * (1 + pct / 100))}
                </small>
                <strong>{money(expiryPnl(c, spot * (1 + pct / 100)))}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.forecast}>
        <label>
          My reason for this trade
          <input
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="What do I expect, and why is this price attractive?"
          />
        </label>
        <label>
          My exit / invalidation / review time
          <input
            value={exit}
            onChange={(e) => setExit(e.target.value)}
            placeholder="Write the plan before opening the venue"
          />
        </label>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={checks} onChange={(e) => setChecks(e.target.checked)} /> I
        checked existing positions, free margin and the complete combo in the venue preview.
      </label>
      <p className={styles.note}>
        {thesis && exit && checks
          ? 'Review notes complete. Recheck the live venue price before deciding.'
          : 'Complete the three review fields before deciding. Notes remain only while this page is open.'}
      </p>
      {c.venue === 'thalex' ? (
        <p className={styles.note}>
          Thalex estimate assumes Tier 1 and an atomic combo: only the highest-fee leg is charged.
          Use the strategy builder’s net limit price and verify both legs. Combos are
          immediate-or-cancel; they cannot rest in the book. USDt daily settlement and portfolio
          margin still apply.{' '}
          <a
            href="https://thalex.com/trading-information/combination-orders"
            target="_blank"
            rel="noreferrer"
          >
            Combo rules
          </a>{' '}
          ·{' '}
          <a href="https://thalex.com/trading-information/fees" target="_blank" rel="noreferrer">
            Fees
          </a>
        </p>
      ) : (
        <p className={styles.note}>
          Fee estimate assumes separate taker fees on both legs. Verify this venue’s
          combination-order support and margin before execution; separate orders can leave one leg
          unfilled.
        </p>
      )}
    </section>
  );
}
