import { Spinner } from '@components/ui';
import { fmtStrike } from '@lib/format';
import { useT } from '@lib/i18n';
import { useState } from 'react';
import { analyticsMessages } from './messages';
import { useTradfiParity } from './queries';
import styles from './Analytics.module.css';

const price = (value: number | null) => value == null ? '—' : value.toFixed(2);

export function ParityPanel({ underlying, expiries, initialExpiry }: { underlying: string; expiries: string[]; initialExpiry: string }) {
  const t = useT(analyticsMessages);
  const [expiry, setExpiry] = useState(initialExpiry);
  const [limit, setLimit] = useState(50);
  const query = useTradfiParity(underlying, expiry);
  const data = query.data;
  return <section className={styles.panel}>
    <div className={styles.panelHead}>
      <h2>{t('parity')}</h2>
      <label className={styles.inlineLabel}>{t('parityExpiry')}<select value={expiry} onChange={(e) => { setExpiry(e.target.value); setLimit(50); }}>{expiries.map((e) => <option key={e} value={e}>{e}</option>)}</select></label>
    </div>
    <p className={styles.note}>{t('parityNote')}</p>
    {query.isLoading && <Spinner size="lg" label={t('loadingParity')} />}
    {query.error && <p className={styles.note} role="alert">{query.error.message}</p>}
    {!expiry && <p className={styles.note}>{t('parityEmpty')}</p>}
    {data && <>
      <p className={styles.note}>{t(data.europeanConsistency ? 'consistencyNote' : 'unsupported')}</p>
      <p className={styles.note}>{t('qualityNote', { age: data.maxQuoteAgeMs / 60_000, skew: data.maxQuoteSkewMs / 1_000 })}</p>
      {data.deferred && <p className={styles.coverage}>{t('parityDeferred')}</p>}
      {!data.streaming && <p className={styles.coverage}>{t('offline')}</p>}
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead><tr>{(['root', 'strike', 'spread', 'forward', 'residual', 'interval', 'reference', 'age', 'status'] as const).map((key) => <th scope="col" key={key}>{t(key)}</th>)}</tr></thead>
          <tbody>{data.rows.slice(0, limit).map((row) => <tr key={`${row.root}:${row.strike}:${row.multiplier}`}>
            <td>{row.root}</td><th scope="row">{fmtStrike(row.strike)}</th>
            <td>{price(row.callMinusPutBid)} / {price(row.callMinusPutAsk)}</td>
            <td>{price(row.zeroRateForward)}</td><td>{price(row.consistencyResidual)}</td>
            <td>{price(row.consistencyLow)} / {price(row.consistencyHigh)}</td>
            <td>{row.referenceStrikes ? row.referenceStrikes.map(fmtStrike).join(' / ') : '—'}</td>
            <td>{row.quoteAgeMs == null ? '—' : `${Math.round(row.quoteAgeMs / 1_000)}s`}</td>
            <td data-usable={row.status === 'ok'}>{t(row.status)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {data.rows.length > limit && <button type="button" className={styles.more} onClick={() => setLimit((n) => n + 50)}>{t('more')}</button>}
    </>}
    <p className={styles.note}>{t('noReference')}</p>
  </section>;
}
