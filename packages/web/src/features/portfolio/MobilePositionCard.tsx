import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';

import { defineMessages, useT, type Translate } from '@lib/i18n';

import { legMessages } from './i18n';
import styles from './MobilePositionCard.module.css';

type LegT = Translate<typeof legMessages.en>;

const messages = defineMessages(
  {
    entry: 'Entry',
    entryIvModel: 'Entry IV back-solved from entry price + forward',
    mark: 'Mark',
    beIv: 'BE IV',
  },
  {
    entry: 'Entrada',
    entryIvModel: 'IV de entrada despejada del precio de entrada + forward',
    mark: 'Mark',
    beIv: 'IV BE',
  },
);

interface Props {
  leg: PositionLeg;
  be: BreakEvenIvRow | undefined;
  readOnly: boolean;
  onRemove: () => void;
  removing: boolean;
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs === 0) return '$0.00';
  return `${sign}$${abs.toFixed(6)}`;
}

function fmtIv(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function beNoteLabel(note: BreakEvenIvRow['beNote'], t: LegT): string | null {
  if (note === 'capped') return '>300%';
  if (note === 'below_intrinsic') return t('belowIntrinsic');
  if (note === 'above_upper') return t('aboveUpper');
  return null;
}

function beNoteTitle(note: BreakEvenIvRow['beNote'], t: LegT): string | undefined {
  if (note === 'capped') return t('cappedTitle');
  if (note === 'below_intrinsic') return t('belowIntrinsicTitle');
  if (note === 'above_upper') return t('aboveUpperTitle');
  return undefined;
}

export default function MobilePositionCard({ leg, be, readOnly, onRemove, removing }: Props) {
  const t = useT(messages);
  const tl = useT(legMessages);
  const isLong = leg.size > 0;
  const noteLabel = beNoteLabel(be?.beNote, tl);
  const noteTitle = beNoteTitle(be?.beNote, tl);
  const cushion = noteLabel != null ? null : be?.ivCushionPct ?? null;
  const cushionTone =
    cushion == null ? 'neutral' : cushion >= 0 ? 'positive' : 'negative';

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <div className={styles.title}>
          <span className={styles.underlying}>{leg.underlying}</span>
          <span className={styles.strike}>{leg.strike.toLocaleString()}</span>
          <span className={styles.right} data-type={leg.optionRight}>
            {leg.optionRight === 'call' ? 'C' : 'P'}
          </span>
          <span className={styles.expiry}>{leg.expiry}</span>
        </div>
        <div className={styles.headRight}>
          <span className={styles.size} data-long={isLong}>
            {isLong ? '+' : ''}
            {leg.size}
          </span>
          {!readOnly && (
            <button
              type="button"
              className={styles.remove}
              onClick={onRemove}
              disabled={removing}
              aria-label={tl('remove', { id: leg.legId })}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.cell}>
          <span className={styles.label}>{t('entry')} {isLong ? tl('debit') : tl('credit')}</span>
          <span className={styles.value}>{fmtUsd(leg.entryPriceUsd)}</span>
          <span
            className={`${styles.sub} ${leg.entryIvIsModel === true ? styles.ivModel : ''}`}
            title={
              leg.entryIvIsModel === true
                ? t('entryIvModel')
                : undefined
            }
          >
            {fmtIv(leg.entryIv)}
            {leg.entryIvIsModel === true ? '*' : ''}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.label}>{t('mark')}</span>
          <span className={styles.value}>{fmtUsd(be?.currentMarkUsd)}</span>
          <span
            className={`${styles.sub} ${be?.currentIvIsModel === true ? styles.ivModel : ''}`}
            title={be?.currentIvIsModel === true ? tl('fairValue') : undefined}
          >
            {fmtIv(be?.currentIv)}
          </span>
        </div>
        <div className={styles.cell}>
          <span className={styles.label}>{t('beIv')}</span>
          <span
            className={`${styles.value} ${noteLabel != null ? styles.beNote : ''}`}
            title={noteTitle}
          >
            {noteLabel ?? fmtIv(be?.breakEvenIv)}
          </span>
          <span className={styles.sub} data-tone={cushionTone} title={noteTitle}>
            {noteLabel != null ? '—' : fmtPct(cushion)}
          </span>
        </div>
      </div>
    </div>
  );
}
