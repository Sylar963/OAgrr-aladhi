import type { PortfolioCloseNow, StrategyGroup } from '@oggregator/protocol';
import { useEffect, useState } from 'react';

import { defineMessages, useLocale, useT, type Translate } from '@lib/i18n';

import {
  type CloseEstimate,
  type CloseLegQuote,
  collarLimit,
  estimateClose,
  markPrice,
} from './close-liquidity';
import { closeNowMessages } from './close-now';
import { fmtUsdSigned } from './format';
import { legSummary, strategyLabel, strategyLabelMessages } from './strategy-label';
import styles from './StrategyGroups.module.css';

interface Props {
  groups: StrategyGroup[];
  closeNow: PortfolioCloseNow | null;
}

const messages = defineMessages(
  {
    sell: 'Sell',
    buy: 'Buy',
    noPrice: 'no price',
    markParen: ' (mark {v})',
    crossesAt: 'crosses @ {v}',
    noAskFull: 'no ask for full size',
    noBidFull: 'no bid for full size',
    mark: 'mark {v}',
    maxBidCollar: 'max bid {v} (collar)',
    minAskCollar: 'min ask {v} (collar)',
    packageAtMark:
      'Package at mark {v}: work a combo limit there, or send these legs as an RFQ.',
    noMarkAll: 'No mark on every leg: send these legs as an RFQ for a price.',
    cantCross: "Can't cross",
    limitAtMark: 'limit at mark {v}',
    rfqOnThalex: 'or RFQ on Thalex',
    slip: 'slip {v}',
    vsMark: ' vs mark',
    staleBook: 'Stale · last estimate',
    slipVsMark: 'slip {v} vs mark',
    excluded: 'excl. {n} not crossable',
    title: 'Strategies & premium',
    subtitle_one:
      '{n} structure detected · open options',
    subtitle_other:
      '{n} structures detected · open options',
    unrealizedPnl: 'Unrealized P&L',
    bidAsk: 'Bid / ask',
    pnlSummary: 'Open options · unrealized P&L at bid/ask',
    pnlMethod: 'Longs sell at bids · shorts buy at asks · estimated exit fees included',
    pnlTooltip:
      'Estimated close cash minus signed entry premium. Uses available Thalex book depth for the full position, including estimated taker exit fees. Entry fees are excluded. Shared legs use their share of the full-position close. No mark-price fallback.',
    exitFees: 'exit fees {v}',
    incomplete: '{n} of {total} groups unpriced',
    awaitingQuotes: 'Waiting for bid/ask',
    updated: 'Updated {time}',
    tableAria: 'Detected strategies and premium',
    structure: 'Structure',
    legs: 'Legs',
    paid: 'Paid',
    received: 'Received',
    net: 'Net',
    maxPL: 'Max P / L',
    beSpot: 'BE spot',
    toClose: 'To close',
    net_credit: 'net credit',
    net_debit: 'net debit',
    net_flat: 'net flat',
    openBook: 'Open book',
  },
  {
    sell: 'Vender',
    buy: 'Comprar',
    noPrice: 'sin precio',
    markParen: ' (mark {v})',
    crossesAt: 'cruza @ {v}',
    noAskFull: 'sin ask para el tamaño completo',
    noBidFull: 'sin bid para el tamaño completo',
    mark: 'mark {v}',
    maxBidCollar: 'bid máx. {v} (collar)',
    minAskCollar: 'ask mín. {v} (collar)',
    packageAtMark:
      'Paquete a mark {v}: trabaja un límite combo ahí, o envía estos legs como RFQ.',
    noMarkAll: 'No todos los legs tienen mark: envía estos legs como RFQ para obtener precio.',
    cantCross: 'No se puede cruzar',
    limitAtMark: 'límite a mark {v}',
    rfqOnThalex: 'o RFQ en Thalex',
    slip: 'slippage {v}',
    vsMark: ' vs mark',
    staleBook: 'Desactualizado · última estimación',
    slipVsMark: 'slippage {v} vs mark',
    excluded: 'excl. {n} no cruzables',
    title: 'Estrategias y prima',
    subtitle_one:
      '{n} estructura detectada · opciones abiertas',
    subtitle_other:
      '{n} estructuras detectadas · opciones abiertas',
    unrealizedPnl: 'P&L no realizado',
    bidAsk: 'Bid / ask',
    pnlSummary: 'Opciones abiertas · P&L no realizado a bid/ask',
    pnlMethod: 'Longs venden al bid · shorts compran al ask · incluye comisiones estimadas de salida',
    pnlTooltip:
      'Efectivo estimado del cierre menos prima de entrada con signo. Usa la profundidad disponible de Thalex para toda la posición e incluye comisiones taker estimadas de salida. Excluye comisiones de entrada. Los legs compartidos usan su proporción del cierre completo. Sin sustituir por mark.',
    exitFees: 'comisiones de salida {v}',
    incomplete: '{n} de {total} grupos sin precio',
    awaitingQuotes: 'Esperando bid/ask',
    updated: 'Actualizado {time}',
    tableAria: 'Estrategias detectadas y prima',
    structure: 'Estructura',
    legs: 'Legs',
    paid: 'Pagado',
    received: 'Recibido',
    net: 'Neto',
    maxPL: 'Máx. P / L',
    beSpot: 'Spot BE',
    toClose: 'Para cerrar',
    net_credit: 'crédito neto',
    net_debit: 'débito neto',
    net_flat: 'neto plano',
    openBook: 'Libro abierto',
  },
);

type T = Translate<typeof messages.en>;

function fmtAmount(abs: number): string {
  if (abs >= 100) return `$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 0.01) return `$${abs.toFixed(2)}`;
  return fmtUsdSigned(abs).slice(1);
}

function fmtCashFlow(value: number): string {
  if (Math.abs(value) < 0.005) return '$0';
  return `${value > 0 ? '+' : '-'}${fmtAmount(Math.abs(value))}`;
}

function fmtPnl(value: number): string {
  const sign = value <= -0.005 ? '-' : value >= 0.005 ? '+' : '';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

function closeLegLine({ label, side, size, quote }: CloseLegQuote, t: T): string {
  const verb = side === 'sell' ? t('sell') : t('buy');
  const at = quote.exitVwapUsd != null ? `@ ${fmtPrice(quote.exitVwapUsd)}` : t('noPrice');
  const vsMark = quote.venueMarkUsd != null ? t('markParen', { v: fmtPrice(quote.venueMarkUsd) }) : '';
  return `${verb} ${size} ${label} ${at}${vsMark}`;
}

function workingLegLine(leg: CloseLegQuote, t: T): string {
  const verb = leg.side === 'sell' ? t('sell') : t('buy');
  const { quote } = leg;
  const mark = markPrice(quote);
  const collar = collarLimit(leg);
  const book =
    quote.status === 'ok' && quote.exitVwapUsd != null
      ? t('crossesAt', { v: fmtPrice(quote.exitVwapUsd) })
      : t(leg.side === 'buy' ? 'noAskFull' : 'noBidFull');
  const parts = [book];
  if (mark != null) parts.push(t('mark', { v: fmtPrice(mark) }));
  if (collar != null) {
    parts.push(t(leg.side === 'buy' ? 'maxBidCollar' : 'minAskCollar', { v: fmtPrice(collar) }));
  }
  return `${verb} ${leg.size} ${leg.label}: ${parts.join(' · ')}`;
}

function workingTitle(legs: CloseLegQuote[], markCashUsd: number | null, t: T): string {
  const lines = legs.map((leg) => workingLegLine(leg, t));
  lines.push(
    markCashUsd != null
      ? t('packageAtMark', { v: fmtCashFlow(markCashUsd) })
      : t('noMarkAll'),
  );
  return lines.join('\n');
}

function CloseCell({ estimate }: { estimate: CloseEstimate }) {
  const t = useT(messages);
  const tc = useT(closeNowMessages);
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
          title={workingTitle(estimate.legs, estimate.markCashUsd, t)}
        >
          {t('cantCross')}
          {estimate.problems.map((p) => (
            <small key={p}>{p}</small>
          ))}
          {estimate.markCashUsd != null && (
            <small data-hint>{t('limitAtMark', { v: fmtCashFlow(estimate.markCashUsd) })}</small>
          )}
          <small data-hint>{t('rfqOnThalex')}</small>
        </span>
      );
    case 'ok': {
      const slip = estimate.slippageUsd;
      const pct = estimate.slippagePct;
      return (
        <span
          role="cell"
          className={styles.close}
          data-side={netSide(estimate.cashUsd)}
          data-stale={estimate.stale || undefined}
          title={[...estimate.legs.map((leg) => closeLegLine(leg, t)), tc('comboNote')].join('\n')}
        >
          {fmtCashFlow(estimate.cashUsd)}
          {slip != null && (
            <small data-slip={pct != null && pct >= 10 ? 'high' : undefined}>
              {t('slip', { v: fmtAmount(Math.abs(slip)) })}
              {pct != null ? ` · ${pct.toFixed(1)}%` : ''}
              {t('vsMark')}
            </small>
          )}
          {estimate.stale && <small data-hint>{t('staleBook')}</small>}
        </span>
      );
    }
  }
}

function PnlCell({ estimates, cell = true }: { estimates: CloseEstimate[]; cell?: boolean }) {
  const t = useT(messages);
  const priced = estimates.filter((estimate) => estimate.status === 'ok');
  const complete = priced.length === estimates.length;
  const pnl = complete ? priced.reduce((sum, estimate) => sum + estimate.pnlUsd, 0) : null;
  const fees = priced.reduce((sum, estimate) => sum + estimate.feesUsd, 0);
  const stale = priced.some((estimate) => estimate.stale);
  const missing = estimates.find((estimate) => estimate.status !== 'ok');
  const note = complete
    ? t('exitFees', { v: fmtAmount(fees) })
    : estimates.length > 1
      ? t('incomplete', { n: estimates.length - priced.length, total: estimates.length })
      : missing?.status === 'unavailable'
        ? missing.reason
        : missing?.status === 'no_market'
          ? missing.problems.join(' · ')
          : t('awaitingQuotes');
  return (
    <span
      role={cell ? 'cell' : undefined}
      className={styles.pnlCell}
      data-side={pnl == null ? undefined : netSide(pnl)}
      data-stale={stale || undefined}
      title={t('pnlTooltip')}
    >
      <strong className={styles.pnlValue}>{pnl == null ? '—' : fmtPnl(pnl)}</strong>
      <small>{note}</small>
      {stale && <small data-warning>{t('staleBook')}</small>}
    </span>
  );
}

function TotalCloseCell({ estimates }: { estimates: CloseEstimate[] }) {
  const t = useT(messages);
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
    <span role="cell" className={styles.close} data-side={netSide(cash)} data-stale={ok.some((e) => e.stale) || undefined}>
      {fmtCashFlow(cash)}
      {slip != null && <small>{t('slipVsMark', { v: fmtAmount(Math.abs(slip)) })}</small>}
      {excluded > 0 && (
        <small data-slip="high">{t('excluded', { n: excluded })}</small>
      )}
      {ok.some((e) => e.stale) && <small>{t('staleBook')}</small>}
    </span>
  );
}

export default function StrategyGroupsPanel({ groups, closeNow }: Props) {
  const t = useT(messages);
  const tc = useT(closeNowMessages);
  const tl = useT(strategyLabelMessages);
  const locale = useLocale();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  if (groups.length === 0) return null;

  const ordered = [
    ...groups.filter((g) => g.kind !== 'naked'),
    ...groups.filter((g) => g.kind === 'naked'),
  ];
  const totalPaid = groups.reduce((acc, g) => acc + g.grossDebitUsd, 0);
  const totalReceived = groups.reduce((acc, g) => acc + g.grossCreditUsd, 0);
  const totalNet = totalReceived - totalPaid;
  const structureCount = groups.length - groups.filter((g) => g.kind === 'naked').length;
  const feedStale = closeNow != null && now - closeNow.computedAt > 5_000;
  const closeEstimates = new Map(groups.map((g) => {
    const estimate = estimateClose(g, closeNow, locale);
    return [g.groupId, estimate.status === 'ok'
      ? { ...estimate, stale: estimate.stale || feedStale }
      : estimate];
  }));
  const estimates = [...closeEstimates.values()];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>{t('title')}</span>
        <span className={styles.subtitle}>
          {t(structureCount === 1 ? 'subtitle_one' : 'subtitle_other', { n: structureCount })}
        </span>
      </div>
      <div className={styles.pnlSummary}>
        <div className={styles.pnlCopy}>
          <span className={styles.pnlLabel}>{t('pnlSummary')}</span>
          <span className={styles.pnlMethod}>{t('pnlMethod')}</span>
          {closeNow != null && (
            <span className={styles.updated}>
              {t('updated', { time: new Date(closeNow.computedAt).toLocaleTimeString() })}
            </span>
          )}
        </div>
        <PnlCell estimates={estimates} cell={false} />
      </div>
      <div className={styles.tableScroll}>
        <div className={styles.table} role="table" aria-label={t('tableAria')}>
          <div className={styles.row} role="row" data-head>
            <span role="columnheader">{t('structure')}</span>
            <span role="columnheader">{t('legs')}</span>
            <span role="columnheader">{t('paid')}</span>
            <span role="columnheader">{t('received')}</span>
            <span role="columnheader">{t('net')}</span>
            <span role="columnheader">{t('maxPL')}</span>
            <span role="columnheader">{t('beSpot')}</span>
            <span role="columnheader" title={tc('tooltip')}>
              {t('toClose')}
            </span>
            <span role="columnheader" title={t('pnlTooltip')}>
              {t('unrealizedPnl')}{' '}<small>{t('bidAsk')}</small>
            </span>
          </div>
          {ordered.map((group) => {
            const net = -group.netEntryPremiumUsd;
            const side = netSide(net);
            const close = closeEstimates.get(group.groupId) ?? { status: 'loading' };
            return (
              <div key={group.groupId} className={styles.row} role="row">
                <span role="rowheader" className={styles.kind} data-kind={group.kind}>
                  {strategyLabel(group, tl)}
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
                  <small>{t(`net_${side}`)}</small>
                </span>
                <span role="cell" className={styles.maxRange}>
                  {`+${fmtUsd(group.maxProfitUsd)} / -${fmtUsd(group.maxLossUsd)}`}
                </span>
                <span role="cell" className={styles.be}>
                  {fmtSpot(group.breakEvenSpotsUsd)}
                </span>
                <CloseCell estimate={close} />
                <PnlCell estimates={[close]} />
              </div>
            );
          })}
          <div className={styles.row} role="row" data-total>
            <span role="rowheader">{t('openBook')}</span>
            <span role="cell" />
            <span role="cell" className={styles.num}>
              {fmtCashFlow(-totalPaid)}
            </span>
            <span role="cell" className={styles.num}>
              {fmtCashFlow(totalReceived)}
            </span>
            <span role="cell" className={styles.num} data-side={netSide(totalNet)}>
              {fmtCashFlow(totalNet)}
              <small>{t(`net_${netSide(totalNet)}`)}</small>
            </span>
            <span role="cell" />
            <span role="cell" />
            <TotalCloseCell estimates={estimates} />
            <PnlCell estimates={estimates} />
          </div>
        </div>
      </div>
    </div>
  );
}
