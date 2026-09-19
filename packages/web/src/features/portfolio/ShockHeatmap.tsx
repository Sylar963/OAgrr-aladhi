import { useState } from 'react';

import type { ShockGridCell, ShockGridMeta } from '@oggregator/protocol';

import styles from './ShockHeatmap.module.css';

interface Props {
  grid: ShockGridCell[][];
  meta: ShockGridMeta | null;
  currentUnrealizedPnl: number | null;
}

type ValueMode = 'incremental' | 'total';

function fmtUsdShort(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.005) return '$0';
  const sign = value > 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  if (abs < 100) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtAxis(value: number, digits = 0): string {
  if (Math.abs(value) < 1e-9) return '0';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function colorFor(pnl: number, maxAbs: number): string {
  if (maxAbs <= 0) return '#181c24';
  const ratio = Math.max(-1, Math.min(1, pnl / maxAbs));
  if (Math.abs(ratio) < 1e-9) return '#181c24';
  if (ratio > 0) {
    const alpha = 0.15 + 0.6 * ratio;
    return `rgba(74, 222, 128, ${alpha})`;
  }
  const alpha = 0.15 + 0.6 * Math.abs(ratio);
  return `rgba(248, 113, 113, ${alpha})`;
}

function valueFor(cell: ShockGridCell, mode: ValueMode, currentUnrealizedPnl: number): number {
  return mode === 'total' ? currentUnrealizedPnl + cell.totalPnlUsd : cell.totalPnlUsd;
}

export default function ShockHeatmap({ grid, meta, currentUnrealizedPnl }: Props) {
  const [valueMode, setValueMode] = useState<ValueMode>('incremental');

  if (grid.length === 0 || grid[0] == null || grid[0].length === 0) {
    return <div className={styles.empty}>Add positions to see vol-shock P&amp;L.</div>;
  }

  const openPnl = currentUnrealizedPnl ?? 0;
  const allCells = grid.flat();
  const maxAbs = allCells.reduce(
    (max, cell) => Math.max(max, Math.abs(valueFor(cell, valueMode, openPnl))),
    0,
  );
  const colLabels = grid[0].map((cell) => cell.skewShiftPerLogK);
  const pricedLegs = meta?.pricedLegs ?? 0;
  const totalLegs = meta?.totalLegs ?? 0;
  const coverageComplete = totalLegs > 0 && pricedLegs === totalLegs;

  return (
    <section className={styles.wrap} aria-labelledby="vol-matrix-title">
      <div className={styles.header}>
        <div>
          <div className={styles.title} id="vol-matrix-title">Vol repricing matrix</div>
          <div className={styles.subtitle}>Immediate surface shock · spot, forwards and time held constant</div>
        </div>
        <div className={styles.modeToggle} role="group" aria-label="Matrix value mode">
          <button
            type="button"
            data-active={valueMode === 'incremental' || undefined}
            aria-pressed={valueMode === 'incremental'}
            onClick={() => setValueMode('incremental')}
          >
            Shock impact
          </button>
          <button
            type="button"
            data-active={valueMode === 'total' || undefined}
            aria-pressed={valueMode === 'total'}
            onClick={() => setValueMode('total')}
          >
            Total open P&amp;L
          </button>
        </div>
      </div>

      <div className={styles.referenceStrip}>
        <div className={styles.locationBlock}>
          <span className={styles.nowBadge}><i />NOW</span>
          <div>
            <span className={styles.referenceLabel}>You are here</span>
            <strong>0 vol pts · 0 skew tilt</strong>
          </div>
        </div>
        <div className={styles.referenceMetric}>
          <span>Current open P&amp;L</span>
          <strong data-sign={openPnl >= 0 ? 'positive' : 'negative'}>{fmtUsdShort(openPnl)}</strong>
        </div>
        <div className={styles.referenceMetric}>
          <span>Repricing coverage</span>
          <strong data-coverage={coverageComplete ? 'complete' : 'partial'}>
            {pricedLegs}/{totalLegs} legs
          </strong>
        </div>
        <div className={styles.referenceMetric}>
          <span>Skew anchor</span>
          <strong>Each leg forward</strong>
        </div>
      </div>

      {!coverageComplete && totalLegs > 0 && (
        <div className={styles.coverageWarning} role="status">
          {totalLegs - pricedLegs} leg{totalLegs - pricedLegs === 1 ? '' : 's'} excluded because live IV, forward or time-to-expiry is unavailable.
        </div>
      )}

      <div className={styles.tableScroll}>
        <table className={styles.grid}>
          <caption className={styles.srOnly}>
            Portfolio P&amp;L under parallel implied-volatility and skew-tilt shocks
          </caption>
          <thead>
            <tr>
              <th className={styles.axisCorner}>
                <span>ATM vol ↓</span>
                <span>Skew tilt →</span>
              </th>
              {colLabels.map((skew) => {
                const isCurrent = Math.abs(skew) < 1e-9;
                return (
                  <th key={`col-${skew}`} data-current-axis={isCurrent || undefined}>
                    {fmtAxis(skew * 100)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => {
              const atmShift = row[0]?.atmShiftVolPts ?? 0;
              const isCurrentRow = Math.abs(atmShift) < 1e-9;
              return (
                <tr key={`row-${atmShift}`}>
                  <th data-current-axis={isCurrentRow || undefined}>{fmtAxis(atmShift, 1)}</th>
                  {row.map((cell) => {
                    const isCurrent =
                      Math.abs(cell.atmShiftVolPts) < 1e-9 &&
                      Math.abs(cell.skewShiftPerLogK) < 1e-9;
                    const displayValue = valueFor(cell, valueMode, openPnl);
                    const title = isCurrent
                      ? `Current surface · shock impact ${fmtUsdShort(cell.totalPnlUsd)} · total open P&L ${fmtUsdShort(openPnl)}`
                      : `ATM IV ${fmtAxis(cell.atmShiftVolPts, 1)} vol pts · skew slope ${fmtAxis(cell.skewShiftPerLogK * 100)} vol pts/log-K · ${valueMode === 'total' ? 'total' : 'impact'} ${fmtUsdShort(displayValue)}`;

                    return (
                      <td
                        key={`${cell.atmShiftVolPts}-${cell.skewShiftPerLogK}`}
                        data-current={isCurrent || undefined}
                        style={{ background: colorFor(displayValue, maxAbs) }}
                        title={title}
                      >
                        {isCurrent && <span className={styles.youAreHere}>You are here</span>}
                        <span
                          className={styles.cellValue}
                          {...(isCurrent ? { 'data-testid': 'current-shock-cell-value' } : {})}
                        >
                          {fmtUsdShort(displayValue)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.legend}>
        <span><b>Rows</b> parallel ATM IV shift in vol points</span>
        <span><b>Columns</b> skew-slope change in vol points per ln(K/F)</span>
        <span><b>Values</b> {valueMode === 'total' ? 'current open P&L + shock impact' : 'model-consistent change from now'}</span>
      </div>
    </section>
  );
}
