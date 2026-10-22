import type { PositionLeg } from '@features/portfolio';
import { fmtNum, fmtPct, fmtUsdPrice } from '@lib/format';
import { defineMessages, type Translate, useT } from '@lib/i18n';
import type { LiquidityResponse } from '@oggregator/protocol';
import { type FormEvent, useId, useMemo, useState } from 'react';
import { useLiquidity } from './hooks/useLiquidity';
import {
  LIQUIDITY_DEFAULT_INSTRUMENTS,
  type LiquidityRequest,
  type LiquiditySide,
  thalexOptionSymbol,
} from './liquidity';
import styles from './LiquidityCard.module.css';

const LADDER_ROWS = 8;

const messages = defineMessages(
  {
    header: 'Liquidity estimate (Thalex book)',
    instrument: 'Instrument',
    side: 'Side',
    takingAsks: 'Taking asks',
    hittingBids: 'Hitting bids',
    sizeCoin: 'Size (coin)',
    estimate: 'Estimate',
    loadingBook: 'Loading book…',
    filled: 'Filled',
    vwap: 'VWAP',
    worstLevel: 'Worst level',
    vsMark: 'vs mark',
    vsTouch: 'vs touch',
    spread: 'Spread',
    within: 'Within',
    bidSize: 'Bid size',
    askSize: 'Ask size',
    ofMark: '±{pct}% of mark',
    ladder: 'Order book ladder',
    bid: 'Bid',
    ask: 'Ask',
    resyncing: 'resyncing',
    crossed: 'crossed book',
    live: 'live · {ms}ms',
    err404: 'Thalex has no book for that instrument.',
    err429: 'Too many books open right now; try again shortly.',
    err400: 'Use a Thalex instrument name, e.g. BTC-PERPETUAL or BTC-23OCT26-84000-C.',
    errDefault: 'Book unavailable right now.',
  },
  {
    header: 'Estimación de liquidez (libro de Thalex)',
    instrument: 'Instrumento',
    side: 'Lado',
    takingAsks: 'Tomando asks',
    hittingBids: 'Pegando a bids',
    sizeCoin: 'Tamaño (moneda)',
    estimate: 'Estimar',
    loadingBook: 'Cargando libro…',
    filled: 'Ejecutado',
    vwap: 'VWAP',
    worstLevel: 'Peor nivel',
    vsMark: 'vs mark',
    vsTouch: 'vs touch',
    spread: 'Spread',
    within: 'Dentro de',
    bidSize: 'Tamaño bid',
    askSize: 'Tamaño ask',
    ofMark: '±{pct}% del mark',
    ladder: 'Escalera del libro de órdenes',
    bid: 'Bid',
    ask: 'Ask',
    resyncing: 'resincronizando',
    crossed: 'libro cruzado',
    live: 'en vivo · {ms}ms',
    err404: 'Thalex no tiene libro para ese instrumento.',
    err429: 'Hay demasiados libros abiertos; intenta de nuevo en breve.',
    err400: 'Usa un nombre de instrumento de Thalex, p. ej. BTC-PERPETUAL o BTC-23OCT26-84000-C.',
    errDefault: 'Libro no disponible ahora.',
  },
);

type T = Translate<typeof messages.en>;

/** Read-only estimate from Thalex's live book. It never places anything. */
export default function LiquidityCard({ positions }: { positions: PositionLeg[] }) {
  const t = useT(messages);
  const listId = useId();
  const [instrument, setInstrument] = useState('');
  const [side, setSide] = useState<LiquiditySide>('buy');
  const [size, setSize] = useState('1');
  const [request, setRequest] = useState<LiquidityRequest | null>(null);
  const query = useLiquidity(request);

  const suggestions = useMemo(
    () => [
      ...new Set([
        ...LIQUIDITY_DEFAULT_INSTRUMENTS,
        ...positions.filter((leg) => leg.expiry && leg.underlying).map(thalexOptionSymbol),
      ]),
    ],
    [positions],
  );

  const parsedSize = Number(size);
  const canSubmit = instrument.trim() !== '' && Number.isFinite(parsedSize) && parsedSize > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setRequest({ instrument: instrument.trim().toUpperCase(), side, size: parsedSize });
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>{t('header')}</span>
        {query.data && <span className={styles.state}>{stateLabel(query.data, t)}</span>}
      </div>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>
          <span>{t('instrument')}</span>
          <input
            list={listId}
            value={instrument}
            placeholder="BTC-PERPETUAL"
            onChange={(e) => setInstrument(e.target.value)}
            spellCheck={false}
          />
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          <span>{t('side')}</span>
          <select value={side} onChange={(e) => setSide(e.target.value as LiquiditySide)}>
            <option value="buy">{t('takingAsks')}</option>
            <option value="sell">{t('hittingBids')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('sizeCoin')}</span>
          <input
            type="number"
            min="0"
            step="any"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </label>
        <button type="submit" className={styles.submit} disabled={!canSubmit}>
          {t('estimate')}
        </button>
      </form>

      {query.isError && <div className={styles.empty}>{errorText(query.error, t)}</div>}
      {query.isLoading && <div className={styles.empty}>{t('loadingBook')}</div>}
      {query.data && <Estimate data={query.data} />}
    </div>
  );
}

function Estimate({ data }: { data: LiquidityResponse }) {
  const t = useT(messages);
  const { fill } = data;
  return (
    <>
      <div className={styles.metricGrid}>
        <Metric label={t('filled')} value={`${fmtNum(fill.filled, 4)} / ${fmtNum(fill.requested, 4)}`} warn={!fill.fullyFilled} />
        <Metric label={t('vwap')} value={fmtUsdPrice(fill.vwap)} />
        <Metric label={t('worstLevel')} value={fmtUsdPrice(fill.worstPrice)} />
        <Metric label={t('vsMark')} value={fmtPct(fill.slippageVsMarkPct, 3)} />
        <Metric label={t('vsTouch')} value={fmtPct(fill.slippageVsTouchPct, 3)} />
        <Metric label={t('spread')} value={fmtPct(data.spreadPct, 3)} />
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('within')}</th>
            <th className={styles.rightAlign}>{t('bidSize')}</th>
            <th className={styles.rightAlign}>{t('askSize')}</th>
          </tr>
        </thead>
        <tbody>
          {data.depth.map((band) => (
            <tr key={band.pct}>
              <td>{t('ofMark', { pct: band.pct })}</td>
              <td className={styles.rightAlign}>{fmtNum(band.bidAmount, 4)}</td>
              <td className={styles.rightAlign}>{fmtNum(band.askAmount, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className={styles.table} aria-label={t('ladder')}>
        <thead>
          <tr>
            <th className={styles.rightAlign}>{t('bidSize')}</th>
            <th className={styles.rightAlign}>{t('bid')}</th>
            <th className={styles.rightAlign}>{t('ask')}</th>
            <th className={styles.rightAlign}>{t('askSize')}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.min(LADDER_ROWS, Math.max(data.bids.length, data.asks.length)) }, (_, i) => (
            <tr key={i}>
              <td className={styles.rightAlign}>{fmtNum(data.bids[i]?.amount, 4)}</td>
              <td className={`${styles.rightAlign} ${styles.bid}`}>{fmtUsdPrice(data.bids[i]?.price)}</td>
              <td className={`${styles.rightAlign} ${styles.ask}`}>{fmtUsdPrice(data.asks[i]?.price)}</td>
              <td className={styles.rightAlign}>{fmtNum(data.asks[i]?.amount, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={`${styles.metricValue} ${warn ? styles.warn : ''}`}>{value}</div>
    </div>
  );
}

function stateLabel(data: LiquidityResponse, t: T): string {
  if (data.state !== 'synced') return t('resyncing');
  if (data.crossed) return t('crossed');
  return t('live', { ms: Math.round(data.bookAgeMs) });
}

function errorText(error: unknown, t: T): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/404/.test(message)) return t('err404');
  if (/429/.test(message)) return t('err429');
  if (/400/.test(message)) return t('err400');
  return t('errDefault');
}
