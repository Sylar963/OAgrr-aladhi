import { useState } from 'react';

import type { EntryVolDrift, ShockGridCell, ShockGridMeta } from '@oggregator/protocol';

import styles from './ShockHeatmap.module.css';

interface Props {
  grid: ShockGridCell[][];
  meta: ShockGridMeta | null;
  entryGrid?: ShockGridCell[][];
  entryDrift?: EntryVolDrift | null;
  currentUnrealizedPnl: number | null;
}

type ValueMode = 'incremental' | 'total';
type AnchorMode = 'now' | 'entry';

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

function nearestIndex(axis: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < axis.length; i += 1) {
    if (Math.abs((axis[i] ?? 0) - value) < Math.abs((axis[best] ?? 0) - value)) best = i;
  }
  return best;
}

function isZeroIndex(axis: number[], index: number): boolean {
  return Math.abs(axis[index] ?? Number.NaN) < 1e-9;
}

const BASIS_LABEL: Record<EntryVolDrift['basis'], string> = {
  entry: 'Since entry',
  first_seen: 'Since first seen',
  mixed: 'Since entry / first seen',
};

export default function ShockHeatmap({
  grid,
  meta,
  entryGrid = [],
  entryDrift = null,
  currentUnrealizedPnl,
}: Props) {
  const [valueMode, setValueMode] = useState<ValueMode>('total');
  const [anchorRequested, setAnchorMode] = useState<AnchorMode>('now');

  const entryAvailable = entryDrift != null && (entryGrid[0]?.length ?? 0) > 0;
  const anchorMode: AnchorMode = anchorRequested === 'entry' && entryAvailable ? 'entry' : 'now';
  const activeGrid = anchorMode === 'entry' ? entryGrid : grid;

  if (activeGrid.length === 0 || activeGrid[0] == null || activeGrid[0].length === 0) {
    return <div className={styles.empty}>Add positions to see vol-shock P&amp;L.</div>;
  }

  const openPnl = currentUnrealizedPnl ?? 0;
  const totalUnavailable = valueMode === 'total' && currentUnrealizedPnl == null;
  const sinceEntryPnl = anchorMode === 'entry' ? (entryDrift?.volPnlUsd ?? 0) : 0;
  const valueFor = (cell: ShockGridCell): number =>
    valueMode === 'total' ? openPnl + cell.totalPnlUsd : cell.totalPnlUsd + sinceEntryPnl;

  const maxAbs = activeGrid
    .flat()
    .reduce((max, cell) => Math.max(max, Math.abs(valueFor(cell))), 0);
  const colAxis = activeGrid[0].map((cell) => cell.skewShiftPerLogK);
  const rowAxis = activeGrid.map((row) => row[0]?.atmShiftVolPts ?? 0);
  const nowRow =
    anchorMode === 'entry' && entryDrift != null
      ? nearestIndex(rowAxis, entryDrift.atmShiftVolPts)
      : nearestIndex(rowAxis, 0);
  const nowCol =
    anchorMode === 'entry' && entryDrift != null
      ? nearestIndex(colAxis, entryDrift.skewShiftPerLogK)
      : nearestIndex(colAxis, 0);
  const driftOffGrid =
    anchorMode === 'entry' &&
    entryDrift != null &&
    (entryDrift.atmShiftVolPts < Math.min(...rowAxis) ||
      entryDrift.atmShiftVolPts > Math.max(...rowAxis) ||
      entryDrift.skewShiftPerLogK < Math.min(...colAxis) ||
      entryDrift.skewShiftPerLogK > Math.max(...colAxis));
  const pricedLegs = meta?.pricedLegs ?? 0;
  const totalLegs = meta?.totalLegs ?? 0;
  const coverageComplete = totalLegs > 0 && pricedLegs === totalLegs;
  const basisLabel = entryDrift != null ? BASIS_LABEL[entryDrift.basis] : BASIS_LABEL.entry;
  const driftLabel =
    entryDrift == null
      ? ''
      : `ATM ${fmtAxis(entryDrift.atmShiftVolPts, 1)} pts · skew ${fmtAxis(entryDrift.skewShiftPerLogK * 100)}`;

  return (
    <section className={styles.wrap} aria-labelledby="vol-matrix-title">
      <div className={styles.header}>
        <div>
          <div className={styles.title} id="vol-matrix-title">Vol repricing matrix</div>
          <div className={styles.subtitle}>
            {anchorMode === 'entry'
              ? `Shocks measured from each leg's ${entryDrift?.basis === 'entry' ? 'entry' : 'entry / first-seen'} IV · spot, forwards and time held at now`
              : 'Scenarios recalculate from current market conditions · spot, forwards and time held constant'}
          </div>
        </div>
        <div className={styles.toggles}>
          <div className={styles.modeToggle} role="group" aria-label="Matrix anchor">
            <button
              type="button"
              data-active={anchorMode === 'now' || undefined}
              aria-pressed={anchorMode === 'now'}
              onClick={() => setAnchorMode('now')}
            >
              From now
            </button>
            <button
              type="button"
              data-active={anchorMode === 'entry' || undefined}
              aria-pressed={anchorMode === 'entry'}
              disabled={!entryAvailable}
              title={entryAvailable ? undefined : 'No entry IV available for these legs yet'}
              onClick={() => setAnchorMode('entry')}
            >
              From entry
            </button>
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
      </div>

      <div className={styles.referenceStrip}>
        <div className={styles.locationBlock}>
          <span className={styles.nowBadge}><i />NOW</span>
          <div>
            {anchorMode === 'entry' ? (
              <>
                <span className={styles.referenceLabel}>Vol drift · {basisLabel.toLowerCase()}</span>
                <strong data-testid="entry-drift-label">{driftLabel}</strong>
              </>
            ) : (
              <>
                <span className={styles.referenceLabel}>Live baseline</span>
                <strong>No additional shock</strong>
              </>
            )}
          </div>
        </div>
        <div className={styles.referenceMetric}>
          <span>Current open P&amp;L</span>
          <strong data-sign={openPnl >= 0 ? 'positive' : 'negative'}>{currentUnrealizedPnl == null ? 'Unavailable' : fmtUsdShort(openPnl)}</strong>
        </div>
        <div className={styles.referenceMetric}>
          <span>Repricing coverage</span>
          <strong data-coverage={coverageComplete ? 'complete' : 'partial'}>
            {pricedLegs}/{totalLegs} legs
          </strong>
        </div>
        {anchorMode === 'entry' ? (
          <div className={styles.referenceMetric}>
            <span>Vol P&amp;L {basisLabel.toLowerCase()}</span>
            <strong data-sign={sinceEntryPnl >= 0 ? 'positive' : 'negative'}>
              {fmtUsdShort(sinceEntryPnl)}
            </strong>
          </div>
        ) : (
          <div className={styles.referenceMetric}>
            <span>Skew anchor</span>
            <strong>Each leg forward</strong>
          </div>
        )}
      </div>

      {!coverageComplete && totalLegs > 0 && (
        <div className={styles.coverageWarning} role="status">
          {totalLegs - pricedLegs} leg{totalLegs - pricedLegs === 1 ? '' : 's'} excluded because live IV, forward or time-to-expiry is unavailable.
        </div>
      )}

      {anchorMode === 'entry' && entryDrift?.basis !== 'entry' && (
        <div className={styles.anchorNote}>
          Venue positions don&apos;t report the IV they were opened at; their anchor is the first live IV this server recorded for the leg.
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
              {colAxis.map((skew, colIndex) => (
                <th
                  key={`col-${skew}`}
                  data-current-axis={colIndex === nowCol || undefined}
                  data-entry-axis={(anchorMode === 'entry' && isZeroIndex(colAxis, colIndex)) || undefined}
                >
                  {fmtAxis(skew * 100)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeGrid.map((row, rowIndex) => {
              const atmShift = rowAxis[rowIndex] ?? 0;
              return (
                <tr key={`row-${atmShift}`}>
                  <th
                    data-current-axis={rowIndex === nowRow || undefined}
                    data-entry-axis={(anchorMode === 'entry' && isZeroIndex(rowAxis, rowIndex)) || undefined}
                  >
                    {fmtAxis(atmShift, 1)}
                  </th>
                  {row.map((cell, colIndex) => {
                    const isCurrent = rowIndex === nowRow && colIndex === nowCol;
                    const isEntry =
                      anchorMode === 'entry' &&
                      isZeroIndex(rowAxis, rowIndex) &&
                      isZeroIndex(colAxis, colIndex);
                    const displayValue = valueFor(cell);
                    const title = isCurrent
                      ? anchorMode === 'entry'
                        ? `Now · vol drift ${basisLabel.toLowerCase()} ${driftLabel}${driftOffGrid ? ' (beyond grid range, pinned to edge)' : ''} · vol P&L ${fmtUsdShort(sinceEntryPnl)}`
                        : `Current surface · shock impact ${fmtUsdShort(cell.totalPnlUsd)} · total open P&L ${currentUnrealizedPnl == null ? 'unavailable' : fmtUsdShort(openPnl)}`
                      : `ATM IV ${fmtAxis(cell.atmShiftVolPts, 1)} vol pts · skew slope ${fmtAxis(cell.skewShiftPerLogK * 100)} vol pts/log-K${anchorMode === 'entry' ? ' from entry' : ''} · ${valueMode === 'total' ? 'total' : 'impact'} ${totalUnavailable ? 'unavailable' : fmtUsdShort(displayValue)}`;

                    return (
                      <td
                        key={`${cell.atmShiftVolPts}-${cell.skewShiftPerLogK}`}
                        data-current={isCurrent || undefined}
                        data-entry={(isEntry && !isCurrent) || undefined}
                        style={{ background: totalUnavailable ? '#181c24' : colorFor(displayValue, maxAbs) }}
                        title={title}
                      >
                        {isCurrent && (
                          <span className={styles.baselineLabel}>
                            {anchorMode === 'entry' ? (driftOffGrid ? 'Now · off grid' : 'Now') : 'No additional shock'}
                          </span>
                        )}
                        {isEntry && !isCurrent && <span className={styles.entryLabel}>Entry</span>}
                        <span
                          className={styles.cellValue}
                          {...(isCurrent ? { 'data-testid': 'current-shock-cell-value' } : {})}
                        >
                          {totalUnavailable ? '—' : fmtUsdShort(displayValue)}
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
        {anchorMode === 'entry' ? (
          <span>
            Now moves as live IV drifts from entry; it snaps to the nearest cell. Venue legs use IV
            back-solved from their opening fills at the underlying price of the fill minute.
          </span>
        ) : (
          <span>Baseline stays centered; this is a scenario view, not market movement.</span>
        )}
        <span><b>Rows</b> parallel ATM IV shift in vol points{anchorMode === 'entry' ? ' from entry' : ''}</span>
        <span><b>Columns</b> skew-slope change in vol points per ln(K/F)</span>
        <span>
          <b>Values</b>{' '}
          {valueMode === 'total'
            ? 'current open P&L + move from now to that cell'
            : anchorMode === 'entry'
              ? 'vol P&L versus the entry surface'
              : 'model-consistent change from now'}
        </span>
      </div>
    </section>
  );
}
