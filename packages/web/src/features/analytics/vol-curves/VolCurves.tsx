import { useMemo, useState } from 'react';

import type { EnrichedChainResponse } from '@shared/enriched';
import InfoTip from '@components/ui/InfoTip';
import { defineMessages, useT } from '@lib/i18n';
import analyticsStyles from '../AnalyticsView.module.css';
import {
  SHORT_DATED_DTE,
  buildCurves,
  defaultFocus,
  defaultXDomain,
  formatDays,
  isDefaultVisible,
  medianSpreadVol,
  type SmileCurve,
  type XAxisMode,
} from './model';
import VolCurvesChart from './VolCurvesChart';
import styles from './VolCurves.module.css';

interface VolCurvesProps {
  chains: EnrichedChainResponse[];
  // Parent passes a per-expiry forward as `spotPrice`; we keep it as a fallback
  // but prefer chain.stats.indexPriceUsd (true spot) when available.
  spotPrice: number | null;
}

const messages = defineMessages(
  {
    title: 'Implied Volatility Curves',
    subtitle: 'OTM-blended mark IV per strike · best bid/ask across venues on the focused expiry',
    xAxis: 'X axis',
    strike: 'Strike',
    delta: 'Delta',
    venues: 'Venues',
    resetZoom: 'Reset zoom',
    hint: 'Click an expiry to focus · click its swatch to hide/show · scroll to zoom, drag to pan, double-click to reset',
    hintShortHidden: ' · <{n}d expiries hidden by default',
    hide: 'Hide {label}',
    show: 'Show {label}',
    toExpiry: '{days} to expiry',
    rrTitle: '25Δ risk reversal: call IV − put IV',
    medianSpreadTitle: 'Median best-ask minus best-bid IV across strikes',
    medianSpread: 'Median spread',
    vol: 'vol',
    crossed_one: '{n} crossed strike',
    crossed_other: '{n} crossed strikes',

    guideLabel: 'How to read these curves',
    guideTitle: 'Reading the IV curves',
    g1a: "Each line is one expiry's ",
    g1smile: 'volatility smile',
    g1b: ': implied volatility (Y) vs. strike or delta (X). Per strike we blend the ',
    g1otm: 'OTM side',
    g1c: ' only — puts below the forward, calls above — because OTM options are what actually trade and price the wings.',
    g2head: 'Quote filter:',
    g2: ' a venue contributes only if it has a real market (genuine bid/ask AND OI > 0 or bid ≠ ask) and IV sits in the 5%–500% sanity band. Single wing marks more than 2× the local median beyond ±15% of the forward are dropped (Black-Scholes degeneracy as option price → 0).',
    g3head: 'Focused expiry:',
    g3a: ' defaults to the expiry nearest 30 days. Every strike gets a vertical bar from the ',
    g3bid: 'best bid IV',
    g3b: ' (highest across venues) to the ',
    g3ask: 'best ask IV',
    g3c: " (lowest across venues) on the OTM contract. Bar length is the executable spread in vol points; bar opacity scales with open interest. A short bar means the mark is well anchored; a long bar means the curve there is mostly the venue's model.",
    g4head: 'Crossed',
    g4: " strikes have one venue's bid above another venue's ask on the same contract, by at least 0.25 vol AND in USD price. Both are required: coin-settled and USD-settled venues convert to USD with different reference prices, and each venue backs out IV against its own forward. This is before fees, size limits and settlement-currency risk, so treat it as a lead to check, not a guaranteed edge.",
    g5head: 'Delta axis:',
    g5: ' plots each expiry by Black-76 forward delta (from its mark IV), so 25Δ puts and calls line up across tenors and skew is comparable between short and long expiries. On the strike axis, short-dated smiles always look steeper.',
    li1head: 'Dip',
    li1: ' near the dashed line = ATM IV for that expiry',
    li1spot: ' (spot {spot})',
    li2head: 'Left wing higher than right',
    li2: ' = put skew (downside fear), normal in BTC/ETH.',
    li3head: 'Color = tenor',
    li3: ': light cyan = near-dated, deep navy = long-dated. Near above far = backwardation (event risk priced in).',
    li4: 'Expiries under {n} days are hidden by default — their annualised IV is noisy and would flatten the other curves. Click the swatch to show them.',
  },
  {
    title: 'Curvas de volatilidad implícita',
    subtitle:
      'IV mark combinada OTM por strike · mejor bid/ask entre exchanges en el vencimiento enfocado',
    xAxis: 'Eje X',
    strike: 'Strike',
    delta: 'Delta',
    venues: 'Exchanges',
    resetZoom: 'Restablecer zoom',
    hint: 'Clic en un vencimiento para enfocarlo · clic en su color para ocultar/mostrar · rueda para zoom, arrastra para desplazar, doble clic para restablecer',
    hintShortHidden: ' · vencimientos <{n}d ocultos por defecto',
    hide: 'Ocultar {label}',
    show: 'Mostrar {label}',
    toExpiry: '{days} al vencimiento',
    rrTitle: 'Risk reversal 25Δ: IV call − IV put',
    medianSpreadTitle: 'Mediana de IV mejor ask menos mejor bid entre strikes',
    medianSpread: 'Spread mediano',
    vol: 'vol',
    crossed_one: '{n} strike cruzado',
    crossed_other: '{n} strikes cruzados',

    guideLabel: 'Cómo leer estas curvas',
    guideTitle: 'Cómo leer las curvas de IV',
    g1a: 'Cada línea es la ',
    g1smile: 'sonrisa de volatilidad',
    g1b: ' de un vencimiento: volatilidad implícita (Y) vs. strike o delta (X). En cada strike combinamos solo el ',
    g1otm: 'lado OTM',
    g1c: ' — puts bajo el forward, calls por encima — porque las opciones OTM son las que realmente se negocian y dan precio a las alas.',
    g2head: 'Filtro de cotizaciones:',
    g2: ' un exchange aporta solo si tiene un mercado real (bid/ask genuino Y OI > 0 o bid ≠ ask) y su IV está en la banda razonable de 5%–500%. Se descartan marks aislados en las alas que superen 2× la mediana local más allá de ±15% del forward (degeneración de Black-Scholes cuando el precio de la opción → 0).',
    g3head: 'Vencimiento enfocado:',
    g3a: ' por defecto es el vencimiento más cercano a 30 días. Cada strike tiene una barra vertical desde la ',
    g3bid: 'IV del mejor bid',
    g3b: ' (la más alta entre exchanges) hasta la ',
    g3ask: 'IV del mejor ask',
    g3c: ' (la más baja entre exchanges) en el contrato OTM. El largo de la barra es el spread ejecutable en puntos de vol; su opacidad escala con el open interest. Una barra corta indica un mark bien anclado; una larga indica que la curva ahí es mayormente el modelo del exchange.',
    g4head: 'Cruzados',
    g4: ': strikes donde el bid de un exchange supera el ask de otro en el mismo contrato, por al menos 0.25 de vol Y en precio USD. Se exigen ambos: los exchanges liquidados en moneda y en USD convierten a USD con precios de referencia distintos, y cada exchange calcula la IV contra su propio forward. Esto es antes de comisiones, límites de tamaño y riesgo de moneda de liquidación, así que tómalo como una pista a verificar, no como una ventaja garantizada.',
    g5head: 'Eje delta:',
    g5: ' ubica cada vencimiento por delta forward Black-76 (a partir de su IV mark), así los puts y calls 25Δ se alinean entre plazos y el skew es comparable entre vencimientos cortos y largos. En el eje de strike, las sonrisas de corto plazo siempre se ven más empinadas.',
    li1head: 'Valle',
    li1: ' cerca de la línea punteada = IV ATM de ese vencimiento',
    li1spot: ' (spot {spot})',
    li2head: 'Ala izquierda más alta que la derecha',
    li2: ' = skew de puts (miedo a la baja), normal en BTC/ETH.',
    li3head: 'Color = plazo',
    li3: ': cian claro = corto plazo, azul marino = largo plazo. Corto por encima de largo = backwardation (riesgo de evento descontado).',
    li4: 'Los vencimientos de menos de {n} días se ocultan por defecto — su IV anualizada es ruidosa y aplanaría las demás curvas. Haz clic en el color para mostrarlos.',
  },
);

// undefined = automatic (expiry nearest 30 DTE), null = no focus.
type FocusState = string | null | undefined;

function fmtVol(v: number | null): string {
  return v == null ? '–' : `${(v * 100).toFixed(1)}%`;
}

function fmtVolPts(v: number | null, signed = false): string {
  if (v == null) return '–';
  const pts = v * 100;
  return `${signed && pts > 0 ? '+' : ''}${pts.toFixed(1)}`;
}

export default function VolCurves({ chains, spotPrice }: VolCurvesProps) {
  const t = useT(messages);
  const [mode, setMode] = useState<XAxisMode>('strike');
  const [visibility, setVisibility] = useState<Map<string, boolean>>(new Map());
  const [focus, setFocus] = useState<FocusState>(undefined);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showVenues, setShowVenues] = useState(false);
  const [zoom, setZoom] = useState<[number, number] | null>(null);

  const indexSpot = useMemo(
    () => chains.find((c) => c.stats.indexPriceUsd != null)?.stats.indexPriceUsd ?? spotPrice,
    [chains, spotPrice],
  );

  const curves = useMemo(() => buildCurves(chains, indexSpot, Date.now()), [chains, indexSpot]);

  const isVisible = (c: SmileCurve) => visibility.get(c.expiry) ?? isDefaultVisible(c);
  const visibleCurves = curves.filter(isVisible);

  const pinnedExpiry =
    focus === undefined
      ? defaultFocus(visibleCurves)
      : focus != null && visibleCurves.some((c) => c.expiry === focus)
        ? focus
        : null;
  const focusExpiry = hovered ?? pinnedExpiry;
  const focused = curves.find((c) => c.expiry === focusExpiry) ?? null;
  const chartCurves =
    focused != null && !visibleCurves.includes(focused) ? [...visibleCurves, focused] : visibleCurves;

  const defaultDomain = defaultXDomain(mode, visibleCurves, indexSpot);
  const xBounds = useMemo<[number, number] | null>(() => {
    if (mode === 'delta') return [0, 1];
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of curves) {
      for (const p of c.points) {
        lo = Math.min(lo, p.strike);
        hi = Math.max(hi, p.strike);
      }
    }
    return lo < hi ? [lo, hi] : null;
  }, [mode, curves]);

  const xDomain = zoom ?? defaultDomain;

  if (curves.length === 0) return null;

  const pinned = curves.find((c) => c.expiry === pinnedExpiry) ?? null;
  const crossedCount = pinned?.points.filter((p) => p.cross != null).length ?? 0;
  const shortDatedHidden = curves.some((c) => !isDefaultVisible(c) && !isVisible(c));

  const toggleVisible = (c: SmileCurve) => {
    setVisibility((prev) => new Map(prev).set(c.expiry, !isVisible(c)));
  };

  const toggleFocus = (c: SmileCurve) => {
    if (!isVisible(c)) setVisibility((prev) => new Map(prev).set(c.expiry, true));
    setFocus(pinnedExpiry === c.expiry ? null : c.expiry);
  };

  const changeMode = (next: XAxisMode) => {
    setMode(next);
    setZoom(null);
  };

  return (
    <div className={analyticsStyles.card}>
      <div className={styles.header}>
        <div>
          <div className={analyticsStyles.cardTitle}>
            <span>
              {t('title')}
              <ReadingGuide indexSpot={indexSpot} />
            </span>
          </div>
          <div className={analyticsStyles.cardSubtitle}>{t('subtitle')}</div>
        </div>
        <div className={styles.controls}>
          <div className={analyticsStyles.oiToggle} role="group" aria-label={t('xAxis')}>
            <button
              type="button"
              className={analyticsStyles.oiToggleBtn}
              data-active={mode === 'strike' || undefined}
              onClick={() => changeMode('strike')}
            >
              {t('strike')}
            </button>
            <button
              type="button"
              className={analyticsStyles.oiToggleBtn}
              data-active={mode === 'delta' || undefined}
              onClick={() => changeMode('delta')}
            >
              {t('delta')}
            </button>
          </div>
          <div className={analyticsStyles.oiToggle}>
            <button
              type="button"
              className={analyticsStyles.oiToggleBtn}
              data-active={showVenues || undefined}
              aria-pressed={showVenues}
              onClick={() => setShowVenues((v) => !v)}
            >
              {t('venues')}
            </button>
          </div>
          {zoom != null && (
            <button type="button" className={styles.resetBtn} onClick={() => setZoom(null)}>
              {t('resetZoom')}
            </button>
          )}
        </div>
      </div>

      <div className={analyticsStyles.curveHint}>
        {t('hint')}
        {shortDatedHidden ? t('hintShortHidden', { n: SHORT_DATED_DTE }) : ''}
      </div>

      <div className={analyticsStyles.curveLegend}>
        {curves.map((curve) => {
          const visible = isVisible(curve);
          const isPinned = curve.expiry === pinnedExpiry;
          return (
            <span
              key={curve.expiry}
              className={styles.chip}
              data-visible={visible || undefined}
              data-focused={isPinned || undefined}
              onMouseEnter={() => setHovered(curve.expiry)}
              onMouseLeave={() => setHovered(null)}
            >
              <button
                type="button"
                className={styles.chipSwatch}
                aria-label={t(visible ? 'hide' : 'show', { label: curve.label })}
                aria-pressed={visible}
                onClick={() => toggleVisible(curve)}
              >
                <span style={{ background: curve.color }} />
              </button>
              <button
                type="button"
                className={styles.chipLabel}
                aria-pressed={isPinned}
                title={t('toExpiry', { days: formatDays(curve.days) })}
                onClick={() => toggleFocus(curve)}
              >
                {curve.label}
              </button>
            </span>
          );
        })}
      </div>

      {pinned && (
        <div className={styles.focusBar}>
          <span style={{ color: pinned.color }}>{pinned.label}</span>
          <span className={styles.focusStat}>{formatDays(pinned.days)}</span>
          <span className={styles.focusStat}>
            ATM <b>{fmtVol(pinned.atmIv)}</b>
          </span>
          <span className={styles.focusStat} title={t('rrTitle')}>
            25Δ RR <b>{fmtVolPts(pinned.rr25, true)}</b>
          </span>
          <span className={styles.focusStat} title={t('medianSpreadTitle')}>
            {t('medianSpread')}{' '}
            <b>
              {fmtVolPts(medianSpreadVol(pinned.points))} {t('vol')}
            </b>
          </span>
          {crossedCount > 0 && (
            <span className={styles.focusCrossed}>
              {t(crossedCount === 1 ? 'crossed_one' : 'crossed_other', { n: crossedCount })}
            </span>
          )}
        </div>
      )}

      <div className={analyticsStyles.curveChartArea}>
        {xDomain != null && xBounds != null && (
          <VolCurvesChart
            curves={chartCurves}
            focused={focused}
            mode={mode}
            xDomain={xDomain}
            xBounds={xBounds}
            onXDomainChange={setZoom}
            showVenues={showVenues}
            indexSpot={indexSpot}
          />
        )}
      </div>
    </div>
  );
}

function ReadingGuide({ indexSpot }: { indexSpot: number | null }) {
  const t = useT(messages);
  return (
    <InfoTip label={t('guideLabel')} title={t('guideTitle')} align="start">
      <p>
        {t('g1a')}
        <strong>{t('g1smile')}</strong>
        {t('g1b')}
        <strong>{t('g1otm')}</strong>
        {t('g1c')}
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>{t('g2head')}</strong>
        {t('g2')}
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>{t('g3head')}</strong>
        {t('g3a')}
        <strong style={{ color: 'var(--color-profit)' }}>{t('g3bid')}</strong>
        {t('g3b')}
        <strong style={{ color: 'var(--color-loss)' }}>{t('g3ask')}</strong>
        {t('g3c')}
      </p>
      <p style={{ marginTop: 6 }}>
        <strong style={{ color: 'var(--color-warning)' }}>{t('g4head')}</strong>
        {t('g4')}
      </p>
      <p style={{ marginTop: 6 }}>
        <strong>{t('g5head')}</strong>
        {t('g5')}
      </p>
      <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        <li>
          <strong>{t('li1head')}</strong>
          {t('li1')}
          {indexSpot != null ? t('li1spot', { spot: `$${(indexSpot / 1000).toFixed(1)}k` }) : ''}.
        </li>
        <li>
          <strong>{t('li2head')}</strong>
          {t('li2')}
        </li>
        <li>
          <strong>{t('li3head')}</strong>
          {t('li3')}
        </li>
        <li>{t('li4', { n: SHORT_DATED_DTE })}</li>
      </ul>
    </InfoTip>
  );
}
