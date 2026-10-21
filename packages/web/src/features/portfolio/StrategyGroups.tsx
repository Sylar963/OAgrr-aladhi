import type { PortfolioCloseNow, StrategyGroup } from '@oggregator/protocol';

import {
  type CloseEstimate,
  type CloseLegQuote,
  collarLimit,
  estimateClose,
  markPrice,
} from './close-liquidity';
import { CLOSE_NOW_COMBO_NOTE, CLOSE_NOW_TOOLTIP, giveBackLevel } from './close-now';
import { fmtUsdSigned } from './format';
import styles from './StrategyGroups.module.css';

interface Props {
  groups: StrategyGroup[];
  closeNow: PortfolioCloseNow | null;
}

function strategyLabel(group: StrategyGroup): string {
  const long = group.legs.find((l) => l.size > 0);
  const short = group.legs.find((l) => l.size < 0);
  const first = group.legs[0];
  switch (group.kind) {
    case 'call_spread':
      return long != null && short != null && long.strike < short.strike
        ? 'Bull call spread'
        : 'Bear call spread';
    case 'put_spread':
      return long != null && short != null && long.strike > short.strike
        ? 'Bear put spread'
        : 'Bull put spread';
    case 'straddle':
      return (first?.size ?? 0) > 0 ? 'Long straddle' : 'Short straddle';
    case 'strangle':
      return (first?.size ?? 0) > 0 ? 'Long strangle' : 'Short strangle';
    case 'iron_condor':
    case 'iron_butterfly': {
      const name = group.kind === 'iron_condor' ? 'iron condor' : 'iron butterfly';
      const outer = [...group.legs].sort((a, b) => a.strike - b.strike)[0];
      return (outer?.size ?? 0) > 0 ? `Short ${name}` : `Long ${name}`;
    }
    case 'naked':
      return `${(first?.size ?? 0) > 0 ? 'Long' : 'Short'} ${first?.optionRight ?? 'option'}`;
  }
}

function fmtQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function legSummary(group: StrategyGroup): string {
  const strikes = [...group.legs]
    .sort((a, b) => a.strike - b.strike)
    .map((l) => `${l.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}${l.optionRight === 'call' ? 'C' : 'P'}`)
    .join(' / ');
  const qty = Math.abs(group.legs[0]?.size ?? 0);
  return `${strikes} × ${fmtQty(qty)}`;
}

function fmtAmount(abs: number): string {
  if (abs >= 100) return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 0.01) return `$${abs.toFixed(2)}`;
  return fmtUsdSigned(abs).slice(1);
}

function fmtCashFlow(value: number): string {
  if (Math.abs(value) < 0.005) return '$0';
  return `${value > 0 ? '+' : '-'}${fmtAmount(Math.abs(value))}`;
}

function fmtUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '∞';
  return fmtAmount(Math.abs(value));
}

function fmtSpot(values: number[]): string {
  if (values.length === 0) return '—';
  return values
    .map((v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }))
    .join(' / ');
}

function netSide(net: number): 'credit' | 'debit' | 'flat' {
  if (net > 0.005) return 'credit';
  if (net < -0.005) return 'debit';
  return 'flat';
}

function fmtPrice(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 });
}

function closeLegLine({ label, side, size, quote }: CloseLegQuote): string {
  const verb = side === 'sell' ? 'Sell' : 'Buy';
  const at = quote.exitVwapUsd != null ? `@ ${fmtPrice(quote.exitVwapUsd)}` : 'no price';
  const vsMark = quote.venueMarkUsd != null ? ` (mark ${fmtPrice(quote.venueMarkUsd)})` : '';
  return `${verb} ${size} ${label} ${at}${vsMark}`;
}

function workingLegLine(leg: CloseLegQuote): string {
  const verb = leg.side === 'sell' ? 'Sell' : 'Buy';
  const { quote } = leg;
  const mark = markPrice(quote);
  const collar = collarLimit(leg);
  const book =
    quote.status === 'ok' && quote.exitVwapUsd != null
      ? `crosses @ ${fmtPrice(quote.exitVwapUsd)}`
      : `${leg.side === 'buy' ? 'no ask' : 'no bid'} for full size`;
  const parts = [book];
  if (mark != null) parts.push(`mark ${fmtPrice(mark)}`);
  if (collar != null) {
    parts.push(`${leg.side === 'buy' ? 'max bid' : 'min ask'} ${fmtPrice(collar)} (collar)`);
  }
  return `${verb} ${leg.size} ${leg.label}: ${parts.join(' · ')}`;
}

function workingTitle(legs: CloseLegQuote[], markCashUsd: number | null): string {
  const lines = legs.map(workingLegLine);
  lines.push(
    markCashUsd != null
      ? `Package at mark ${fmtCashFlow(markCashUsd)}: work a combo limit there, or send these legs as an RFQ.`
      : 'No mark on every leg: send these legs as an RFQ for a price.',
  );
  return lines.join('\n');
}

function CloseCell({ estimate }: { estimate: CloseEstimate }) {
  switch (estimate.status) {
    case 'loading':
      return (
        <span role="cell" className={styles.close} data-state="muted">
          …
        </span>
      );
    case 'unavailable':
      return (
        <span role="cell" className={styles.close} data-state="muted">
          —<small>{estimate.reason}</small>
        </span>
      );
    case 'no_market':
      return (
        <span
          role="cell"
          className={styles.close}
          data-state="warn"
          title={workingTitle(estimate.legs, estimate.markCashUsd)}
        >
          {"Can't cross"}
          {estimate.problems.map((p) => (
            <small key={p}>{p}</small>
          ))}
          {estimate.markCashUsd != null && (
            <small data-hint>limit at mark {fmtCashFlow(estimate.markCashUsd)}</small>
          )}
          <small data-hint>or RFQ on Thalex</small>
        </span>
      );
    case 'ok': {
      const slip = estimate.slippageUsd;
      const pct = estimate.slippagePct;
      const strategy = estimate.strategy;
      const level = giveBackLevel(strategy?.giveBackPct);
      return (
        <span
          role="cell"
          className={styles.close}
          data-side={netSide(estimate.cashUsd)}
          data-stale={estimate.stale || undefined}
          title={[...estimate.legs.map(closeLegLine), CLOSE_NOW_COMBO_NOTE].join('\n')}
        >
          {fmtCashFlow(estimate.cashUsd)}
          {slip != null && (
            <small data-slip={pct != null && pct >= 10 ? 'high' : undefined}>
              slip {fmtAmount(Math.abs(slip))}
              {pct != null ? ` · ${pct.toFixed(1)}%` : ''} vs mark
            </small>
          )}
          {strategy?.closeNowPnlUsd != null && (
            <small data-giveback={level ?? undefined}>
              P&amp;L {fmtCashFlow(strategy.closeNowPnlUsd)}
              {strategy.giveBackPct != null ? ` · gives back ${strategy.giveBackPct.toFixed(0)}%` : ''}
            </small>
          )}
          {estimate.stale && <small data-hint>stale book</small>}
        </span>
      );
    }
  }
}

function TotalCloseCell({ estimates }: { estimates: CloseEstimate[] }) {
  const ok = estimates.filter((e) => e.status === 'ok');
  if (estimates.some((e) => e.status === 'loading')) {
    return (
      <span role="cell" className={styles.close} data-state="muted">
        …
      </span>
    );
  }
  if (ok.length === 0) {
    return (
      <span role="cell" className={styles.close} data-state="muted">
        —
      </span>
    );
  }
  const cash = ok.reduce((acc, e) => acc + e.cashUsd, 0);
  const slip = ok.every((e) => e.slippageUsd != null)
    ? ok.reduce((acc, e) => acc + (e.slippageUsd ?? 0), 0)
    : null;
  const excluded = estimates.length - ok.length;
  return (
    <span role="cell" className={styles.close} data-side={netSide(cash)}>
      {fmtCashFlow(cash)}
      {slip != null && <small>slip {fmtAmount(Math.abs(slip))} vs mark</small>}
      {excluded > 0 && (
        <small data-slip="high">
          excl. {excluded} not crossable
        </small>
      )}
    </span>
  );
}

export default function StrategyGroupsPanel({ groups, closeNow }: Props) {
  if (groups.length === 0) return null;

  const ordered = [
    ...groups.filter((g) => g.kind !== 'naked'),
    ...groups.filter((g) => g.kind === 'naked'),
  ];
  const totalPaid = groups.reduce((acc, g) => acc + g.grossDebitUsd, 0);
  const totalReceived = groups.reduce((acc, g) => acc + g.grossCreditUsd, 0);
  const totalNet = totalReceived - totalPaid;
  const structureCount = groups.length - groups.filter((g) => g.kind === 'naked').length;
  const closeEstimates = new Map(groups.map((g) => [g.groupId, estimateClose(g, closeNow)]));

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Strategies &amp; premium</span>
        <span className={styles.subtitle}>
          {structureCount} structure{structureCount === 1 ? '' : 's'} detected · entry premium · to
          close = crossing the Thalex book now, after fees
        </span>
      </div>
      <div className={styles.tableScroll}>
        <div className={styles.table} role="table" aria-label="Detected strategies and premium">
          <div className={styles.row} role="row" data-head>
            <span role="columnheader">Structure</span>
            <span role="columnheader">Legs</span>
            <span role="columnheader">Paid</span>
            <span role="columnheader">Received</span>
            <span role="columnheader">Net</span>
            <span role="columnheader">Max P / L</span>
            <span role="columnheader">BE spot</span>
            <span role="columnheader" title={CLOSE_NOW_TOOLTIP}>
              To close
            </span>
          </div>
          {ordered.map((group) => {
            const net = -group.netEntryPremiumUsd;
            const side = netSide(net);
            const close = closeEstimates.get(group.groupId) ?? { status: 'loading' };
            return (
              <div key={group.groupId} className={styles.row} role="row">
                <span role="rowheader" className={styles.kind} data-kind={group.kind}>
                  {strategyLabel(group)}
                  <small>
                    {group.underlying} · {group.expiry}
                  </small>
                </span>
                <span role="cell" className={styles.detail}>
                  {legSummary(group)}
                </span>
                <span role="cell" className={styles.num}>
                  {fmtCashFlow(-group.grossDebitUsd)}
                </span>
                <span role="cell" className={styles.num}>
                  {fmtCashFlow(group.grossCreditUsd)}
                </span>
                <span role="cell" className={styles.num} data-side={side}>
                  {fmtCashFlow(net)}
                  <small>net {side}</small>
                </span>
                <span role="cell" className={styles.maxRange}>
                  {`+${fmtUsd(group.maxProfitUsd)} / -${fmtUsd(group.maxLossUsd)}`}
                </span>
                <span role="cell" className={styles.be}>
                  {fmtSpot(group.breakEvenSpotsUsd)}
                </span>
                <CloseCell estimate={close} />
              </div>
            );
          })}
          <div className={styles.row} role="row" data-total>
            <span role="rowheader">Open book</span>
            <span role="cell" />
            <span role="cell" className={styles.num}>
              {fmtCashFlow(-totalPaid)}
            </span>
            <span role="cell" className={styles.num}>
              {fmtCashFlow(totalReceived)}
            </span>
            <span role="cell" className={styles.num} data-side={netSide(totalNet)}>
              {fmtCashFlow(totalNet)}
              <small>net {netSide(totalNet)}</small>
            </span>
            <span role="cell" />
            <span role="cell" />
            <TotalCloseCell estimates={[...closeEstimates.values()]} />
          </div>
        </div>
      </div>
    </div>
  );
}
