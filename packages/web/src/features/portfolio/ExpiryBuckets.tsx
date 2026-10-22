import type { ExpiryBucketRow } from '@oggregator/protocol';

import { defineMessages, useT } from '@lib/i18n';

import styles from './ExpiryBuckets.module.css';

const messages = defineMessages(
  {
    empty: 'Add positions to see risk by expiry.',
    title: 'Risk by expiry',
    contracts: 'contracts',
  },
  {
    empty: 'Agrega posiciones para ver el riesgo por vencimiento.',
    title: 'Riesgo por vencimiento',
    contracts: 'contratos',
  },
);

interface Props {
  rows: ExpiryBucketRow[];
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function fmtSigned(value: number, digits = 2): string {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${trimTrailingZeros(Math.abs(value).toFixed(digits))}`;
}

function fmtContracts(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (Number.isInteger(value)) return abs.toFixed(0);
  if (abs >= 10) return trimTrailingZeros(abs.toFixed(2));
  if (abs >= 1) return trimTrailingZeros(abs.toFixed(3));
  return trimTrailingZeros(abs.toFixed(4));
}

function fmtGamma(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return '+0';
  if (abs >= 0.01) return fmtSigned(value, 4);
  if (abs >= 0.0001) return fmtSigned(value, 6);
  return `${value >= 0 ? '+' : '-'}${abs.toExponential(2)}`;
}

export default function ExpiryBuckets({ rows }: Props) {
  const t = useT(messages);
  if (rows.length === 0) {
    return <div className={styles.empty}>{t('empty')}</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.title}>{t('title')}</div>
      <div className={styles.list}>
        {rows.map((row) => (
          <div key={row.expiry} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.expiry}>{row.expiry}</span>
              <span className={styles.dte}>{row.dte}d</span>
            </div>
            <div className={styles.stats}>
              <span className={styles.stat}>{t('contracts')} {fmtContracts(row.contracts)}</span>
              <span className={styles.stat}>vega {fmtSigned(row.vega, 3)}</span>
              <span className={styles.stat}>gamma {fmtGamma(row.gamma)}</span>
              <span className={styles.stat}>theta {fmtSigned(row.theta, 2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
