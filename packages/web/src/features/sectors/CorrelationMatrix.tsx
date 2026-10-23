import { defineMessages, useT } from '@lib/i18n';
import type { CryptoSectorCorrelationResponse } from '@oggregator/protocol';
import { type CSSProperties, useMemo, useState } from 'react';

import { clusterOrder } from './cluster';
import styles from './CorrelationMatrix.module.css';

const messages = defineMessages(
  {
    window: 'Window',
    basis: 'Basis',
    raw: 'ρ',
    exBtc: 'ex-BTC',
    btc: 'BTC',
    hours: '{n}h',
    cell: '{a} × {b}: {v}',
    noData: 'Not enough 5m data for this window yet.',
    note: 'Pairwise correlation of 5m sector returns. Grouped so sectors that move together sit side by side. ex-BTC removes each sector’s BTC beta first.',
    decoupled: 'Decoupling from the other sectors',
  },
  {
    window: 'Ventana',
    basis: 'Base',
    raw: 'ρ',
    exBtc: 'sin BTC',
    btc: 'BTC',
    hours: '{n}h',
    cell: '{a} × {b}: {v}',
    noData: 'Aún no hay suficientes datos de 5m para esta ventana.',
    note: 'Correlación por pares de los retornos de 5m de cada sector. Agrupados para que los sectores que se mueven juntos queden lado a lado. Sin BTC quita primero la beta a BTC de cada sector.',
    decoupled: 'Desacoplándose del resto de sectores',
  },
);

type Basis = 'raw' | 'exBtc';

/** Diverging tint: accent for positive, info for negative, strength by |ρ|. */
function cellStyle(v: number | null): CSSProperties | undefined {
  if (v == null) return undefined;
  const color = v >= 0 ? 'var(--accent-primary)' : 'var(--color-info)';
  return {
    background: `color-mix(in srgb, ${color} ${Math.round(Math.min(Math.abs(v), 1) * 70)}%, var(--bg-surface))`,
  };
}

export default function CorrelationMatrix({ data }: { data: CryptoSectorCorrelationResponse }) {
  const t = useT(messages);
  const [viewIndex, setViewIndex] = useState(0);
  const [basis, setBasis] = useState<Basis>('raw');

  const view = data.views[viewIndex] ?? data.views[0];
  const order = useMemo(() => (view ? clusterOrder(view.matrix) : []), [view]);
  const names = new Map(data.sectors.map((s) => [s.id, s.name]));
  const decoupled = new Set(data.sectors.filter((s) => s.decoupled).map((s) => s.id));

  if (!view) return <div className={styles.empty}>{t('noData')}</div>;

  const grid = basis === 'raw' ? view.matrix : view.residualMatrix;
  const hasData = view.matrix.some((row) => row.some((v) => v != null));
  const label = (i: number) => names.get(data.sectorIds[i]!) ?? data.sectorIds[i]!;

  return (
    <section className={styles.root}>
      <div className={styles.controls}>
        <span className={styles.controlLabel}>{t('window')}</span>
        <div className={styles.segmented} role="group" aria-label={t('window')}>
          {data.views.map((v, i) => (
            <button
              key={v.windowBars}
              type="button"
              aria-pressed={i === viewIndex}
              onClick={() => setViewIndex(i)}
            >
              {t('hours', { n: (v.windowBars * data.barSec) / 3600 })}
            </button>
          ))}
        </div>
        <span className={styles.controlLabel}>{t('basis')}</span>
        <div className={styles.segmented} role="group" aria-label={t('basis')}>
          {(['raw', 'exBtc'] as const).map((b) => (
            <button key={b} type="button" aria-pressed={b === basis} onClick={() => setBasis(b)}>
              {t(b)}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.note}>{t('note')}</p>

      {!hasData ? (
        <div className={styles.empty}>{t('noData')}</div>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th aria-hidden="true" />
                {order.map((j) => (
                  <th key={j} scope="col" className={styles.colHead}>
                    <span>{label(j)}</span>
                  </th>
                ))}
                <th scope="col" className={`${styles.colHead} ${styles.btcHead}`}>
                  <span>{t('btc')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {order.map((i) => {
                const id = data.sectorIds[i]!;
                return (
                  <tr key={id}>
                    <th scope="row" className={styles.rowHead}>
                      {label(i)}
                      {decoupled.has(id) && (
                        <span className={styles.flag} title={t('decoupled')} aria-label={t('decoupled')}>
                          ◆
                        </span>
                      )}
                    </th>
                    {order.map((j) => {
                      const v = i === j ? null : (grid[i]?.[j] ?? null);
                      return (
                        <td
                          key={j}
                          className={styles.cell}
                          data-diag={i === j || undefined}
                          style={cellStyle(v)}
                          title={
                            v == null
                              ? undefined
                              : t('cell', { a: label(i), b: label(j), v: v.toFixed(2) })
                          }
                        >
                          {v == null ? '' : v.toFixed(2)}
                        </td>
                      );
                    })}
                    <td
                      className={`${styles.cell} ${styles.btcCell}`}
                      style={cellStyle(view.corrBtc[i] ?? null)}
                    >
                      {view.corrBtc[i] == null ? '—' : view.corrBtc[i]!.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
