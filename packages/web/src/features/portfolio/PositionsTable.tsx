import type { BreakEvenIvRow, CloseNowLeg, PositionLeg } from '@oggregator/protocol';

import { useIsMobile } from '@hooks/useIsMobile';
import { defineMessages, useLocale, useT, type Translate } from '@lib/i18n';

import { closeNowMessages, fmtAge, legFillStatus, spreadNote, staleNote } from './close-now';
import { legMessages } from './i18n';
import MobilePositionCard from './MobilePositionCard';
import { useRemovePosition } from './hooks/queries';
import styles from './PositionsTable.module.css';

type LegT = Translate<typeof legMessages.en>;

const messages = defineMessages(
  {
    closeNowPnl: 'Close-now P&L {v}',
    fees: 'Fees {v}',
    emptyReadOnly: 'No open positions.',
    empty: 'No positions yet — add a leg below.',
    underlying: 'Underlying',
    expiry: 'Expiry',
    strike: 'Strike',
    right: 'R',
    size: 'Size',
    entryUsd: 'Entry $',
    debitCredit: 'D/C',
    entryIv: 'Entry IV',
    markUsd: 'Mark $',
    liveIv: 'Live IV',
    breakEvenIv: 'Break-even IV',
    ivCushion: 'IV Cushion',
    closeNow: 'Close now',
    longLeg: 'Long leg: {v} paid per contract.',
    shortLeg: 'Short leg: {v} received per contract.',
    entryIvModel: 'Entry IV back-solved from entry price + forward at upsert time',
  },
  {
    closeNowPnl: 'P&L al cerrar ahora {v}',
    fees: 'Comisiones {v}',
    emptyReadOnly: 'No hay posiciones abiertas.',
    empty: 'Aún no hay posiciones — agrega un leg abajo.',
    underlying: 'Subyacente',
    expiry: 'Vencimiento',
    strike: 'Strike',
    right: 'T',
    size: 'Tamaño',
    entryUsd: 'Entrada $',
    debitCredit: 'D/C',
    entryIv: 'IV entrada',
    markUsd: 'Mark $',
    liveIv: 'IV en vivo',
    breakEvenIv: 'IV breakeven',
    ivCushion: 'Colchón IV',
    closeNow: 'Cerrar ahora',
    longLeg: 'Leg long: {v} pagados por contrato.',
    shortLeg: 'Leg short: {v} recibidos por contrato.',
    entryIvModel: 'IV de entrada despejada del precio de entrada + forward al momento de guardar',
  },
);

interface Props {
  positions: PositionLeg[];
  breakEven: BreakEvenIvRow[];
  closeNow?: CloseNowLeg[];
  readOnly?: boolean;
  emptyMessage?: string;
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

function CloseNowCell({ leg }: { leg: CloseNowLeg | undefined }) {
  const t = useT(messages);
  const tc = useT(closeNowMessages);
  const locale = useLocale();
  if (leg == null) return <td className={styles.closeNow}>—</td>;
  const priced = leg.exitVwapUsd != null;
  const title = [
    tc('tooltip'),
    leg.closeNowPnlUsd != null ? t('closeNowPnl', { v: fmtUsd(leg.closeNowPnlUsd) }) : null,
    leg.feesUsd > 0 ? t('fees', { v: fmtUsd(leg.feesUsd) }) : null,
    spreadNote(leg, locale),
    staleNote(leg, locale),
  ]
    .filter((line): line is string => line != null)
    .join('\n');
  return (
    <td className={styles.closeNow} data-status={leg.status} data-stale={leg.stale || undefined} title={title}>
      {priced ? fmtUsd(leg.exitVwapUsd) : '—'}
      <small>
        {legFillStatus(leg, locale)}
        {leg.bookAgeMs != null ? ` · ${fmtAge(leg.bookAgeMs)}` : ''}
      </small>
    </td>
  );
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

export default function PositionsTable({
  positions,
  breakEven,
  closeNow,
  readOnly = false,
  emptyMessage,
}: Props) {
  const t = useT(messages);
  const tl = useT(legMessages);
  const tc = useT(closeNowMessages);
  const removePosition = useRemovePosition();
  const isMobile = useIsMobile();
  const breakEvenByLegId = new Map(breakEven.map((row) => [row.legId, row]));
  const closeNowByLegId = new Map((closeNow ?? []).map((row) => [row.legId, row]));

  if (positions.length === 0) {
    const fallback = readOnly ? t('emptyReadOnly') : t('empty');
    return <div className={styles.empty}>{emptyMessage ?? fallback}</div>;
  }

  if (isMobile) {
    return (
      <div className={styles.cardList}>
        {positions.map((leg) => (
          <MobilePositionCard
            key={leg.legId}
            leg={leg}
            be={breakEvenByLegId.get(leg.legId)}
            readOnly={readOnly}
            onRemove={() => removePosition.mutate(leg.legId)}
            removing={removePosition.isPending}
          />
        ))}
      </div>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('underlying')}</th>
          <th>{t('expiry')}</th>
          <th>{t('strike')}</th>
          <th>{t('right')}</th>
          <th>{t('size')}</th>
          <th>{t('entryUsd')}</th>
          <th>{t('debitCredit')}</th>
          <th>{t('entryIv')}</th>
          <th>{t('markUsd')}</th>
          <th>{t('liveIv')}</th>
          <th>{t('breakEvenIv')}</th>
          <th>{t('ivCushion')}</th>
          {closeNow != null && <th title={tc('tooltip')}>{t('closeNow')}</th>}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {positions.map((leg) => {
          const be = breakEvenByLegId.get(leg.legId);
          const cushionClass =
            be?.ivCushionPct == null
              ? styles.cushionNeutral
              : be.ivCushionPct >= 0
                ? styles.cushionPos
                : styles.cushionNeg;
          const noteLabel = beNoteLabel(be?.beNote, tl);
          const noteTitle = beNoteTitle(be?.beNote, tl);
          const debitOrCredit = leg.size > 0 ? tl('debit') : tl('credit');
          const entryPrice = `$${leg.entryPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
          const debitOrCreditTitle =
            leg.size > 0 ? t('longLeg', { v: entryPrice }) : t('shortLeg', { v: entryPrice });
          return (
            <tr key={leg.legId}>
              <td>{leg.underlying}</td>
              <td>{leg.expiry}</td>
              <td>{leg.strike.toLocaleString()}</td>
              <td>{leg.optionRight === 'call' ? 'C' : 'P'}</td>
              <td className={leg.size > 0 ? styles.long : styles.short}>{leg.size}</td>
              <td>{fmtUsd(leg.entryPriceUsd)}</td>
              <td
                className={leg.size > 0 ? styles.debit : styles.credit}
                title={debitOrCreditTitle}
              >
                {debitOrCredit}
              </td>
              <td
                className={leg.entryIvIsModel === true ? styles.ivModel : undefined}
                title={
                  leg.entryIvIsModel === true
                    ? t('entryIvModel')
                    : undefined
                }
              >
                {fmtIv(leg.entryIv)}
                {leg.entryIvIsModel === true ? '*' : ''}
              </td>
              <td>{fmtUsd(be?.currentMarkUsd)}</td>
              <td
                className={be?.currentIvIsModel === true ? styles.ivModel : undefined}
                title={
                  be?.currentIvIsModel === true ? tl('fairValue') : undefined
                }
              >
                {fmtIv(be?.currentIv)}
              </td>
              <td
                className={noteLabel != null ? styles.beNote : undefined}
                title={noteTitle}
              >
                {noteLabel ?? fmtIv(be?.breakEvenIv)}
              </td>
              <td className={cushionClass} title={noteTitle}>
                {noteLabel != null ? '—' : fmtPct(be?.ivCushionPct)}
              </td>
              {closeNow != null && <CloseNowCell leg={closeNowByLegId.get(leg.legId)} />}
              <td>
                {readOnly ? null : (
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => removePosition.mutate(leg.legId)}
                    disabled={removePosition.isPending}
                    aria-label={tl('remove', { id: leg.legId })}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
