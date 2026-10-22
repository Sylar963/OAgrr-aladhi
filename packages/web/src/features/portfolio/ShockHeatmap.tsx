import { useState } from 'react';

import type {
  EntryVolDrift,
  PnlAttribution,
  ShockGridCell,
  ShockGridMeta,
} from '@oggregator/protocol';

import { defineMessages, useT } from '@lib/i18n';

import styles from './ShockHeatmap.module.css';

interface Props {
  grid: ShockGridCell[][];
  meta: ShockGridMeta | null;
  entryGrid?: ShockGridCell[][];
  entryDrift?: EntryVolDrift | null;
  attribution?: PnlAttribution | null;
  currentUnrealizedPnl: number | null;
}

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

const messages = defineMessages(
  {
    basis_entry: 'Since entry',
    basis_first_seen: 'Since first seen',
    basis_mixed: 'Since entry / first seen',
    empty: 'Add positions to see vol-shock P&L.',
    driftLabel: 'ATM {atm} pts · skew {skew}',
    title: 'Vol repricing matrix',
    subtitleEntry:
      "Shocks measured from each leg's entry IV · spot, forwards and time held at now",
    subtitleMixed:
      "Shocks measured from each leg's entry / first-seen IV · spot, forwards and time held at now",
    subtitleNow:
      'Scenarios recalculate from current market conditions · spot, forwards and time held constant',
    anchorAria: 'Matrix anchor',
    fromNow: 'From now',
    fromEntry: 'From entry',
    noEntryIv: 'No entry IV available for these legs yet',
    nowBadge: 'NOW',
    volDrift: 'Vol drift · {basis}',
    liveBaseline: 'Live baseline',
    noShock: 'No additional shock',
    openPnl: 'Open P&L',
    spot: 'Spot (Δ + Γ)',
    time: 'Time (Θ)',
    volSquare: 'Vol · square',
    other: 'Other',
    noFills_one: 'No fills · {n} leg',
    noFills_other: 'No fills · {n} legs',
    excluded_one:
      '{n} leg excluded because live IV, forward or time-to-expiry is unavailable.',
    excluded_other:
      '{n} legs excluded because live IV, forward or time-to-expiry is unavailable.',
    anchorNote:
      "Venue positions don't report the IV they were opened at; their anchor is the first live IV this server recorded for the leg.",
    caption: 'Portfolio P&L under parallel implied-volatility and skew-tilt shocks',
    atmVolAxis: 'ATM vol ↓',
    skewTiltAxis: 'Skew tilt →',
    titleNowEntry: 'Now · vol drift {basis} {drift}{offGrid} · vol P&L {pnl}',
    beyondGrid: ' (beyond grid range, pinned to edge)',
    titleCurrent: 'Current surface · no additional shock',
    titleCell: 'ATM IV {atm} vol pts · skew slope {skew} vol pts/log-K{fromEntry} · {pnl}',
    fromEntrySuffix: ' from entry',
    nowOffGrid: 'Now · off grid',
    now: 'Now',
    entry: 'Entry',
    legendEntry:
      'Now moves as live IV drifts from entry; it snaps to the nearest cell. Venue legs use IV back-solved from their opening fills at the underlying price of the fill minute.',
    legendNow: 'Baseline stays centered; this is a scenario view, not market movement.',
    rows: 'Rows',
    rowsText: ' parallel ATM IV shift in vol points{fromEntry}',
    columns: 'Columns',
    columnsText: ' skew-slope change in vol points per ln(K/F)',
    values: 'Values',
    valuesEntry: 'vol P&L versus the entry surface',
    valuesNow: 'model-consistent change from now',
    split: 'Split',
    splitText:
      ' Black-76 revaluation from entry: spot, then time, then IV. Other is venue mark and fill prices versus the model.',
    unavailable: 'Unavailable',
  },
  {
    basis_entry: 'Desde la entrada',
    basis_first_seen: 'Desde que se vio por primera vez',
    basis_mixed: 'Desde la entrada / primera vez visto',
    empty: 'Agrega posiciones para ver el P&L ante shocks de vol.',
    driftLabel: 'ATM {atm} pts · skew {skew}',
    title: 'Matriz de revaloración por vol',
    subtitleEntry:
      'Shocks medidos desde la IV de entrada de cada leg · spot, forwards y tiempo fijos en el presente',
    subtitleMixed:
      'Shocks medidos desde la IV de entrada / primera vista de cada leg · spot, forwards y tiempo fijos en el presente',
    subtitleNow:
      'Los escenarios se recalculan con las condiciones actuales del mercado · spot, forwards y tiempo constantes',
    anchorAria: 'Ancla de la matriz',
    fromNow: 'Desde ahora',
    fromEntry: 'Desde la entrada',
    noEntryIv: 'Aún no hay IV de entrada disponible para estos legs',
    nowBadge: 'AHORA',
    volDrift: 'Deriva de vol · {basis}',
    liveBaseline: 'Referencia en vivo',
    noShock: 'Sin shock adicional',
    openPnl: 'P&L abierto',
    spot: 'Spot (Δ + Γ)',
    time: 'Tiempo (Θ)',
    volSquare: 'Vol · cuadrado',
    other: 'Otro',
    noFills_one: 'Sin ejecuciones · {n} leg',
    noFills_other: 'Sin ejecuciones · {n} legs',
    excluded_one:
      '{n} leg excluido porque la IV en vivo, el forward o el tiempo al vencimiento no está disponible.',
    excluded_other:
      '{n} legs excluidos porque la IV en vivo, el forward o el tiempo al vencimiento no está disponible.',
    anchorNote:
      'Las posiciones del exchange no reportan la IV con la que se abrieron; su ancla es la primera IV en vivo que este servidor registró para el leg.',
    caption: 'P&L del portafolio ante shocks paralelos de volatilidad implícita y de inclinación del skew',
    atmVolAxis: 'Vol ATM ↓',
    skewTiltAxis: 'Inclinación skew →',
    titleNowEntry: 'Ahora · deriva de vol {basis} {drift}{offGrid} · P&L de vol {pnl}',
    beyondGrid: ' (fuera del rango de la matriz, fijado al borde)',
    titleCurrent: 'Superficie actual · sin shock adicional',
    titleCell: 'IV ATM {atm} pts de vol · pendiente del skew {skew} pts de vol/log-K{fromEntry} · {pnl}',
    fromEntrySuffix: ' desde la entrada',
    nowOffGrid: 'Ahora · fuera de la matriz',
    now: 'Ahora',
    entry: 'Entrada',
    legendEntry:
      'Ahora se mueve a medida que la IV en vivo se desvía de la entrada; se ajusta a la celda más cercana. Los legs del exchange usan la IV despejada de sus ejecuciones de apertura al precio del subyacente del minuto de la ejecución.',
    legendNow: 'La referencia queda centrada; esta es una vista de escenarios, no movimiento de mercado.',
    rows: 'Filas',
    rowsText: ' cambio paralelo de IV ATM en puntos de vol{fromEntry}',
    columns: 'Columnas',
    columnsText: ' cambio de pendiente del skew en puntos de vol por ln(K/F)',
    values: 'Valores',
    valuesEntry: 'P&L de vol frente a la superficie de entrada',
    valuesNow: 'cambio consistente con el modelo desde ahora',
    split: 'Desglose',
    splitText:
      ' Revaloración Black-76 desde la entrada: spot, luego tiempo, luego IV. Otro es el mark del exchange y los precios de ejecución frente al modelo.',
    unavailable: 'No disponible',
  },
);

export default function ShockHeatmap({
  grid,
  meta,
  entryGrid = [],
  entryDrift = null,
  attribution = null,
  currentUnrealizedPnl,
}: Props) {
  const t = useT(messages);
  const [anchorRequested, setAnchorMode] = useState<AnchorMode>('entry');

  const entryAvailable = entryDrift != null && (entryGrid[0]?.length ?? 0) > 0;
  const anchorMode: AnchorMode = anchorRequested === 'entry' && entryAvailable ? 'entry' : 'now';
  const activeGrid = anchorMode === 'entry' ? entryGrid : grid;

  if (activeGrid.length === 0 || activeGrid[0] == null || activeGrid[0].length === 0) {
    return <div className={styles.empty}>{t('empty')}</div>;
  }

  const sinceEntryPnl = anchorMode === 'entry' ? (entryDrift?.volPnlUsd ?? 0) : 0;
  const valueFor = (cell: ShockGridCell): number => cell.totalPnlUsd + sinceEntryPnl;

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
  const basisLabel = t(`basis_${entryDrift?.basis ?? 'entry'}`);
  const driftLabel =
    entryDrift == null
      ? ''
      : t('driftLabel', {
          atm: fmtAxis(entryDrift.atmShiftVolPts, 1),
          skew: fmtAxis(entryDrift.skewShiftPerLogK * 100),
        });

  return (
    <section className={styles.wrap} aria-labelledby="vol-matrix-title">
      <div className={styles.header}>
        <div>
          <div className={styles.title} id="vol-matrix-title">{t('title')}</div>
          <div className={styles.subtitle}>
            {anchorMode === 'entry'
              ? t(entryDrift?.basis === 'entry' ? 'subtitleEntry' : 'subtitleMixed')
              : t('subtitleNow')}
          </div>
        </div>
        <div className={styles.toggles}>
          <div className={styles.modeToggle} role="group" aria-label={t('anchorAria')}>
            <button
              type="button"
              data-active={anchorMode === 'now' || undefined}
              aria-pressed={anchorMode === 'now'}
              onClick={() => setAnchorMode('now')}
            >
              {t('fromNow')}
            </button>
            <button
              type="button"
              data-active={anchorMode === 'entry' || undefined}
              aria-pressed={anchorMode === 'entry'}
              disabled={!entryAvailable}
              title={entryAvailable ? undefined : t('noEntryIv')}
              onClick={() => setAnchorMode('entry')}
            >
              {t('fromEntry')}
            </button>
          </div>
        </div>
      </div>

      <div className={styles.referenceStrip}>
        <div className={styles.locationBlock}>
          <span className={styles.nowBadge}><i />{t('nowBadge')}</span>
          <div>
            {anchorMode === 'entry' ? (
              <>
                <span className={styles.referenceLabel}>{t('volDrift', { basis: basisLabel.toLowerCase() })}</span>
                <strong data-testid="entry-drift-label">{driftLabel}</strong>
              </>
            ) : (
              <>
                <span className={styles.referenceLabel}>{t('liveBaseline')}</span>
                <strong>{t('noShock')}</strong>
              </>
            )}
          </div>
        </div>
        <Metric label={t('openPnl')} value={currentUnrealizedPnl} testId="open-pnl" />
        {attribution != null && attribution.attributedLegs > 0 && (
          <>
            <Metric label={t('spot')} value={attribution.spotUsd} />
            <Metric label={t('time')} value={attribution.timeUsd} />
            <Metric label={t('volSquare')} value={attribution.volUsd} highlight testId="vol-pnl" />
            <Metric label={t('other')} value={attribution.otherUsd} />
            {attribution.attributedLegs < attribution.totalLegs && (
              <Metric
                label={t(
                  attribution.totalLegs - attribution.attributedLegs === 1 ? 'noFills_one' : 'noFills_other',
                  { n: attribution.totalLegs - attribution.attributedLegs },
                )}
                value={attribution.unattributedUsd}
              />
            )}
          </>
        )}
      </div>

      {!coverageComplete && totalLegs > 0 && (
        <div className={styles.coverageWarning} role="status">
          {t(totalLegs - pricedLegs === 1 ? 'excluded_one' : 'excluded_other', { n: totalLegs - pricedLegs })}
        </div>
      )}

      {anchorMode === 'entry' && entryDrift?.basis !== 'entry' && (
        <div className={styles.anchorNote}>
          {t('anchorNote')}
        </div>
      )}

      <div className={styles.tableScroll}>
        <table className={styles.grid}>
          <caption className={styles.srOnly}>
            {t('caption')}
          </caption>
          <thead>
            <tr>
              <th className={styles.axisCorner}>
                <span>{t('atmVolAxis')}</span>
                <span>{t('skewTiltAxis')}</span>
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
                        ? t('titleNowEntry', {
                            basis: basisLabel.toLowerCase(),
                            drift: driftLabel,
                            offGrid: driftOffGrid ? t('beyondGrid') : '',
                            pnl: fmtUsdShort(sinceEntryPnl),
                          })
                        : t('titleCurrent')
                      : t('titleCell', {
                          atm: fmtAxis(cell.atmShiftVolPts, 1),
                          skew: fmtAxis(cell.skewShiftPerLogK * 100),
                          fromEntry: anchorMode === 'entry' ? t('fromEntrySuffix') : '',
                          pnl: fmtUsdShort(displayValue),
                        });

                    return (
                      <td
                        key={`${cell.atmShiftVolPts}-${cell.skewShiftPerLogK}`}
                        data-current={isCurrent || undefined}
                        data-entry={(isEntry && !isCurrent) || undefined}
                        style={{ background: colorFor(displayValue, maxAbs) }}
                        title={title}
                      >
                        {isCurrent && (
                          <span className={styles.baselineLabel}>
                            {anchorMode === 'entry' ? (driftOffGrid ? t('nowOffGrid') : t('now')) : t('noShock')}
                          </span>
                        )}
                        {isEntry && !isCurrent && <span className={styles.entryLabel}>{t('entry')}</span>}
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
        {anchorMode === 'entry' ? (
          <span>{t('legendEntry')}</span>
        ) : (
          <span>{t('legendNow')}</span>
        )}
        <span>
          <b>{t('rows')}</b>
          {t('rowsText', { fromEntry: anchorMode === 'entry' ? t('fromEntrySuffix') : '' })}
        </span>
        <span>
          <b>{t('columns')}</b>
          {t('columnsText')}
        </span>
        <span>
          <b>{t('values')}</b>{' '}
          {anchorMode === 'entry' ? t('valuesEntry') : t('valuesNow')}
        </span>
        {attribution != null && attribution.attributedLegs > 0 && (
          <span>
            <b>{t('split')}</b>
            {t('splitText')}
          </span>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  highlight = false,
  testId,
}: {
  label: string;
  value: number | null;
  highlight?: boolean;
  testId?: string;
}) {
  const t = useT(messages);
  return (
    <div className={styles.referenceMetric} data-highlight={highlight || undefined}>
      <span>{label}</span>
      <strong
        data-sign={value == null ? undefined : value >= 0 ? 'positive' : 'negative'}
        {...(testId != null ? { 'data-testid': testId } : {})}
      >
        {value == null ? t('unavailable') : fmtUsdShort(value)}
      </strong>
    </div>
  );
}
