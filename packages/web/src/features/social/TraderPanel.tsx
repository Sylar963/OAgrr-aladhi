import { Spinner } from '@components/ui';
import { fmtUsd, formatExpiry } from '@lib/format';
import { defineMessages, intlLocale, type Locale, useLocale, useT } from '@lib/i18n';
import type { PublicTraderDto } from '@oggregator/protocol';

import EquityChart from './EquityChart';
import { socialMessages } from './i18n';
import OpenPositions from './OpenPositions';
import styles from './TraderPanel.module.css';
import VenueTag from './VenueTag';

const messages = defineMessages(
  {
    book: '@{handle} book',
    live: 'live',
    closeTrader: 'Close trader',
    left: '@{handle} is no longer sharing on the leaderboard.',
    waiting: "Waiting for @{handle}'s venue account to connect. Their book streams again once it does.",
    loading: 'Loading @{handle}…',
    equity: 'Equity · {date}',
    pnlSince: 'PnL since {date}',
    return: 'Return',
    sharingSince: 'Sharing since',
    openPositions: 'Open positions · {n}',
    noOpenPositions: 'No open positions.',
    closedTrades: 'Closed trades · {n}',
    noFillHistory: 'does not report fill history.',
    noClosingFills: 'No closing fills yet.',
    instrument: 'Instrument',
    side: 'Side',
    qty: 'Qty',
    price: 'Price',
    closed: 'Closed',
    realized: 'Realized',
    buy: 'buy',
    sell: 'sell',
  },
  {
    book: 'Libro de @{handle}',
    live: 'en vivo',
    closeTrader: 'Cerrar trader',
    left: '@{handle} ya no comparte en el ranking.',
    waiting:
      'Esperando que se conecte la cuenta del exchange de @{handle}. Su libro vuelve a transmitirse cuando se conecte.',
    loading: 'Cargando @{handle}…',
    equity: 'Equity · {date}',
    pnlSince: 'PnL desde {date}',
    return: 'Retorno',
    sharingSince: 'Comparte desde',
    openPositions: 'Posiciones abiertas · {n}',
    noOpenPositions: 'Sin posiciones abiertas.',
    closedTrades: 'Trades cerrados · {n}',
    noFillHistory: 'no reporta historial de ejecuciones.',
    noClosingFills: 'Aún no hay ejecuciones de cierre.',
    instrument: 'Instrumento',
    side: 'Lado',
    qty: 'Cant.',
    price: 'Precio',
    closed: 'Cerrado',
    realized: 'Realizado',
    buy: 'compra',
    sell: 'venta',
  },
);

interface TraderPanelProps {
  handle: string;
  trader: PublicTraderDto | null;
  unavailable: 'left' | 'waiting' | null;
  onClose: () => void;
}

function signedUsd(value: number | null): string {
  if (value == null) return '–';
  if (Math.abs(value) < 0.005) return '$0';
  return `${value > 0 ? '+' : ''}${fmtUsd(value)}`;
}

function tone(value: number | null): 'up' | 'down' | 'flat' {
  if (value == null || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function fmtDate(iso: string | null, locale: Locale): string {
  if (!iso) return '–';
  const date = new Date(iso);
  return date.toLocaleDateString(intlLocale(locale), {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

export default function TraderPanel({ handle, trader, unavailable, onClose }: TraderPanelProps) {
  const t = useT(messages);
  const ts = useT(socialMessages);
  const locale = useLocale();
  return (
    <section className={styles.panel} aria-label={t('book', { handle })}>
      <header className={styles.header}>
        <h3 className={styles.handle}>@{trader?.handle ?? handle}</h3>
        {trader?.isMe && <span className={styles.youTag}>{ts('you')}</span>}
        {trader && <VenueTag venue={trader.venue} />}
        {trader && (
          <span className={styles.live}>
            <span className={styles.liveDot} />
            {t('live')}
          </span>
        )}
        <button className={styles.close} onClick={onClose} aria-label={t('closeTrader')}>
          ×
        </button>
      </header>

      {unavailable === 'left' ? (
        <p className={styles.empty}>{t('left', { handle })}</p>
      ) : unavailable === 'waiting' ? (
        <p className={styles.empty}>{t('waiting', { handle })}</p>
      ) : !trader ? (
        <Spinner size="md" label={t('loading', { handle })} />
      ) : (
        <div className={styles.body}>
          <div className={styles.stats}>
            <Stat
              label={t('equity', { date: fmtDate(trader.equityAsOf, locale) })}
              value={fmtUsd(trader.equityUsd)}
            />
            <Stat
              label={t('pnlSince', { date: fmtDate(trader.startedAt, locale) })}
              value={signedUsd(trader.pnlUsd)}
              tone={tone(trader.pnlUsd)}
            />
            <Stat
              label={t('return')}
              value={`${trader.returnPct > 0 ? '+' : ''}${(trader.returnPct * 100).toFixed(2)}%`}
              tone={tone(trader.returnPct)}
            />
            <Stat label={t('sharingSince')} value={fmtDate(trader.sharingSince, locale)} />
          </div>

          <EquityChart
            points={trader.equityHistory}
            baselineUsd={
              trader.equityHistory.find((point) => point.equityUsd > 0)?.equityUsd ??
              trader.equityUsd
            }
          />

          <h4 className={styles.sectionTitle}>
            {t('openPositions', { n: trader.openPositions.length })}
          </h4>
          {trader.openPositions.length === 0 ? (
            <p className={styles.empty}>{t('noOpenPositions')}</p>
          ) : (
            <OpenPositions positions={trader.openPositions} />
          )}

          <h4 className={styles.sectionTitle}>
            {t('closedTrades', { n: trader.closedTrades.length })}
          </h4>
          {!trader.closedTradesAvailable ? (
            <p className={styles.empty}>
              <VenueTag venue={trader.venue} /> {t('noFillHistory')}
            </p>
          ) : trader.closedTrades.length === 0 ? (
            <p className={styles.empty}>{t('noClosingFills')}</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('instrument')}</th>
                    <th>{t('side')}</th>
                    <th className={styles.num}>{t('qty')}</th>
                    <th className={styles.num}>{t('price')}</th>
                    <th>{t('closed')}</th>
                    <th className={styles.num}>{t('realized')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trader.closedTrades.map((trade) => (
                    <tr key={trade.id}>
                      <td>
                        {trade.underlying} {formatExpiry(trade.expiry)}{' '}
                        {trade.strike.toLocaleString()}
                        <span className={styles.right} data-right={trade.optionRight}>
                          {trade.optionRight === 'call' ? 'C' : 'P'}
                        </span>
                      </td>
                      <td>{t(trade.direction)}</td>
                      <td className={styles.num}>{trade.amount}</td>
                      <td className={styles.num}>{fmtUsd(trade.priceUsd)}</td>
                      <td>{fmtDate(trade.closedAt, locale)}</td>
                      <td className={styles.num} data-tone={tone(trade.realizedPnlUsd)}>
                        {signedUsd(trade.realizedPnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue} data-tone={tone}>
        {value}
      </span>
    </div>
  );
}
