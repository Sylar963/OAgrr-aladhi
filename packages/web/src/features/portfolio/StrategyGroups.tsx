import type { StrategyGroup } from '@oggregator/protocol';

import { fmtUsdSigned } from './format';
import styles from './StrategyGroups.module.css';

interface Props {
  groups: StrategyGroup[];
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

function fmtCashFlow(value: number): string {
  return Math.abs(value) < 0.005 ? '$0' : fmtUsdSigned(value);
}

function fmtUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '∞';
  return `$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

export default function StrategyGroupsPanel({ groups }: Props) {
  if (groups.length === 0) return null;

  const ordered = [
    ...groups.filter((g) => g.kind !== 'naked'),
    ...groups.filter((g) => g.kind === 'naked'),
  ];
  const totalPaid = groups.reduce((acc, g) => acc + g.grossDebitUsd, 0);
  const totalReceived = groups.reduce((acc, g) => acc + g.grossCreditUsd, 0);
  const totalNet = totalReceived - totalPaid;
  const structureCount = groups.length - groups.filter((g) => g.kind === 'naked').length;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Strategies &amp; premium</span>
        <span className={styles.subtitle}>
          {structureCount} structure{structureCount === 1 ? '' : 's'} detected · entry premium
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
          </div>
          {ordered.map((group) => {
            const net = -group.netEntryPremiumUsd;
            const side = netSide(net);
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
                  {group.kind === 'naked'
                    ? '—'
                    : `+${fmtUsd(group.maxProfitUsd)} / −${fmtUsd(group.maxLossUsd)}`}
                </span>
                <span role="cell" className={styles.be}>
                  {fmtSpot(group.breakEvenSpotsUsd)}
                </span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
