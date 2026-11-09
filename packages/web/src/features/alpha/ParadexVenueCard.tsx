import { useAccountSession } from '@components/auth/AccountSessionProvider';
import { VenueDot } from '@components/ui';
import { useParadexRfqs } from '@features/portfolio';
import { fmtUsd } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import type { ParadexRfq } from '@oggregator/protocol';
import { type ReactNode, useEffect, useState } from 'react';
import cards from './VenueOpportunities.module.css';
import styles from './ParadexVenueCard.module.css';

const messages = defineMessages({
  mode: 'Paradex liquidity source',
  screen: 'Screen',
  rfq: 'RFQ',
  scope: 'Your open {underlying} RFQs · all strategies and expiries',
  loading: 'Loading open RFQs…',
  connect: 'Connect Paradex in Portfolio to read your RFQ quotes.',
  unavailable: 'RFQs unavailable. Check your Paradex connection and RFQ access.',
  empty: 'No open RFQs on this page. Create a request on Paradex to receive maker quotes.',
  more: 'Load next RFQ page',
  refreshing: 'Refreshing…',
  bid: 'Strategy bid',
  ask: 'Strategy ask',
  size: 'Size {quantity} · filled {filled}',
  fetched: 'Fetched {time}',
  stale: 'Quote stale or expired · refresh required',
  noQuote: 'Waiting for a quote, or RFQ no longer available.',
  note: 'Prices are USD per strategy unit, before fees. Bid sells the displayed strategy; ask buys it and reverses its SELL legs. RFQ quantities and ratios belong to this request. These quotes do not enter screen rankings. Create and execute requests on Paradex.',
  reference: 'Mark reference {price}',
  screenEmpty: 'Screen candidates need account equity and eligible live bids and asks.',
}, {
  mode: 'Fuente de liquidez de Paradex',
  screen: 'Libro',
  rfq: 'RFQ',
  scope: 'Tus RFQs abiertos de {underlying} · todas las estrategias y vencimientos',
  loading: 'Cargando RFQs abiertos…',
  connect: 'Conecta Paradex en Portafolio para leer tus cotizaciones RFQ.',
  unavailable: 'RFQs no disponibles. Revisa tu conexión y acceso RFQ en Paradex.',
  empty: 'No hay RFQs abiertos en esta página. Crea una solicitud en Paradex para recibir cotizaciones.',
  more: 'Cargar siguiente página RFQ',
  refreshing: 'Actualizando…',
  bid: 'Bid de estrategia',
  ask: 'Ask de estrategia',
  size: 'Tamaño {quantity} · ejecutado {filled}',
  fetched: 'Consultado {time}',
  stale: 'Cotización desactualizada o vencida · requiere actualización',
  noQuote: 'Esperando cotización, o RFQ ya no disponible.',
  note: 'Precios USD por unidad de estrategia, antes de comisiones. El bid vende la estrategia mostrada; el ask la compra e invierte sus patas SELL. Tamaños y ratios pertenecen a esta solicitud. Estas cotizaciones no entran al ranking del libro. Crea y ejecuta solicitudes en Paradex.',
  reference: 'Referencia mark {price}',
  screenEmpty: 'Las oportunidades del libro requieren capital y bids y asks elegibles.',
});

export default function ParadexVenueCard({ underlying, screen }: { underlying: string; screen?: ReactNode }) {
  const t = useT(messages);
  const session = useAccountSession();
  const [rfqMode, setRfqMode] = useState(false);
  const query = useParadexRfqs(underlying, rfqMode);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!rfqMode) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [rfqMode]);
  const rfqs = [...new Map(query.data?.pages.flatMap((page) => page.rfqs).map((rfq) => [rfq.id, rfq]) ?? []).values()];
  return (
    <div className={styles.wrap}>
      <div className={styles.toggle} role="group" aria-label={t('mode')}>
        <span>Paradex</span>
        <button type="button" aria-pressed={!rfqMode} onClick={() => setRfqMode(false)}>{t('screen')}</button>
        <button type="button" aria-pressed={rfqMode} onClick={() => setRfqMode(true)}>{t('rfq')}</button>
      </div>
      {!rfqMode ? screen ?? <p className={styles.message}>{t('screenEmpty')}</p> : (
        <section className={cards.venueCard} data-tone="neutral">
          <header className={cards.venueCardHeader}>
            <span className={cards.venueName}><VenueDot venueId="paradex" />Paradex</span>
            <span className={cards.venueState}>RFQ</span>
          </header>
          <p className={styles.message}>{t('scope', { underlying })}</p>
          {session.status !== 'ready' ? <p className={styles.message}>{t('connect')}</p>
            : query.isPending ? <p className={styles.message}>{t('loading')}</p>
            : query.isError ? <p className={styles.message} role="status">{t('unavailable')}</p>
            : rfqs.length === 0 ? <p className={styles.message}>{t('empty')}</p> : null}
          <div className={styles.quotes}>
            {rfqs.map((rfq) => <RfqQuote key={rfq.id} rfq={rfq} now={now} failed={query.isError} />)}
          </div>
          {query.hasNextPage && <button type="button" className={styles.more} disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{t(query.isFetching ? 'refreshing' : 'more')}</button>}
          <p className={styles.message}>{t('note')}</p>
        </section>
      )}
    </div>
  );
}

function RfqQuote({ rfq, now, failed }: { rfq: ParadexRfq; now: number; failed: boolean }) {
  const t = useT(messages);
  const quote = rfq.quote;
  const stale = failed || (rfq.expiresAt != null && now >= rfq.expiresAt) || (quote != null && now - quote.fetchedAt >= 15_000);
  const price = (value: number | null | undefined, quantity: number | null | undefined) =>
    !stale && value != null && quantity != null && quantity > 0 ? `${fmtUsd(value)} × ${quantity}` : '—';
  return (
    <article className={styles.quote}>
      <strong className={styles.id}>{rfq.id}</strong>
      {rfq.legs.map((leg, index) => <div className={styles.leg} key={`${index}:${leg.market}`}><b>{leg.side}</b><span>{leg.ratio} × {leg.market}{leg.price != null ? ` @ ${fmtUsd(leg.price)}` : ''}</span></div>)}
      <small>{t('size', { quantity: rfq.quantity, filled: rfq.filledQuantity ?? '—' })}</small>
      <dl>
        <div><dt>{t('bid')}</dt><dd>{price(quote?.bidPrice, quote?.bidQuantity)}</dd></div>
        <div><dt>{t('ask')}</dt><dd>{price(quote?.askPrice, quote?.askQuantity)}</dd></div>
      </dl>
      {stale ? <small className={styles.warning}>{t('stale')}</small> : !quote ? <small>{t('noQuote')}</small> : <small>{t('fetched', { time: new Date(quote.fetchedAt).toLocaleTimeString() })}</small>}
      {quote?.markPrice != null && <small>{t('reference', { price: fmtUsd(quote.markPrice) })}</small>}
    </article>
  );
}
