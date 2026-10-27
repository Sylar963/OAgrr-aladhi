import { useQuery } from '@tanstack/react-query';
import {
  FlowEvidenceResponseSchema,
  type ExchangeTradeEvidence,
  type FlowAnalysis,
  type FlowOiContext,
} from '@oggregator/protocol';
import { fetchJson } from '@lib/http';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import { getStrategyLabel } from './StrategyIcon';
import styles from './FlowEvidence.module.css';

const messages = defineMessages(
  {
    structure: 'Structure',
    side: 'Execution',
    position: 'Position effect',
    unknown: 'Open / close unknown',
    buy: 'Bought',
    sell: 'Sold',
    mixed: 'Bought + sold legs',
    taker: 'Taker',
    reported: 'Reported side',
    unlinked: 'Individual print · linkage unknown',
    exchange: 'Exchange-linked legs',
    complete: 'Complete group',
    partial: 'Partial group',
    incomplete: 'Group completeness unknown',
    custom: 'Custom legs',
    loading: 'Loading execution evidence and OI…',
    failed: 'Evidence unavailable. Try reopening this trade.',
    detail: 'Trade evidence',
    note: 'A purchase can open a long or close a short. These public prints do not establish opening or closing.',
    instrument: 'Instrument',
    quantity: 'Quantity ({unit})',
    action: 'Action',
    oi: 'Open-interest context',
    oiNote:
      'OI is sampled, usually every 15 minutes. Exchange reporting may lag. Full trade coverage is unverified; an interval change cannot identify this trade’s position effect.',
    unavailable: 'No usable OI bracket',
    pending: 'Waiting for the next OI sample',
    gap: 'Gap between samples',
    bracketed: 'Samples bracket this trade',
    delta: 'OI change',
    window: 'Observed interval',
    before: 'Before',
    after: 'After',
    block: 'Block ID',
    rfq: 'RFQ ID',
    combo: 'Combo',
    execution: 'Combo execution ID',
    sequence: 'Trade sequence',
    liquidation: 'Liquidation side',
    maker: 'Maker',
    both: 'Maker + taker',
    implied: 'Implied taker execution',
    partialNote: 'Some legs are missing. No complete structure is asserted.',
    unsupported: 'Some leg fields could not be validated.',
    minutes: '{value} min',
    noEvidence: 'No exchange grouping metadata was retained for this print.',
  },
  {
    structure: 'Estructura',
    side: 'Ejecución',
    position: 'Efecto en posición',
    unknown: 'Apertura / cierre desconocido',
    buy: 'Compra',
    sell: 'Venta',
    mixed: 'Patas compradas + vendidas',
    taker: 'Taker',
    reported: 'Lado reportado',
    unlinked: 'Print individual · vínculo desconocido',
    exchange: 'Patas vinculadas por el exchange',
    complete: 'Grupo completo',
    partial: 'Grupo parcial',
    incomplete: 'Integridad del grupo desconocida',
    custom: 'Patas personalizadas',
    loading: 'Cargando evidencia de ejecución y OI…',
    failed: 'Evidencia no disponible. Vuelve a abrir este trade.',
    detail: 'Evidencia del trade',
    note: 'Una compra puede abrir un largo o cerrar un corto. Estos prints públicos no establecen apertura o cierre.',
    instrument: 'Instrumento',
    quantity: 'Cantidad ({unit})',
    action: 'Acción',
    oi: 'Contexto de interés abierto',
    oiNote:
      'El OI se muestrea normalmente cada 15 minutos. El exchange puede reportarlo con demora. La cobertura total de trades no está verificada; el cambio del intervalo no identifica el efecto de este trade.',
    unavailable: 'Sin muestras de OI suficientes',
    pending: 'Esperando la siguiente muestra de OI',
    gap: 'Hueco entre muestras',
    bracketed: 'Muestras antes y después del trade',
    delta: 'Cambio de OI',
    window: 'Intervalo observado',
    before: 'Antes',
    after: 'Después',
    block: 'ID del bloque',
    rfq: 'ID del RFQ',
    combo: 'Combo',
    execution: 'ID de ejecución del combo',
    sequence: 'Secuencia del trade',
    liquidation: 'Lado liquidado',
    maker: 'Maker',
    both: 'Maker + taker',
    implied: 'Ejecución de taker implícita',
    partialNote: 'Faltan algunas patas. No se afirma una estructura completa.',
    unsupported: 'No se pudieron validar algunos campos de las patas.',
    minutes: '{value} min',
    noEvidence: 'No se conservaron metadatos de agrupación del exchange para este print.',
  },
);

export function FlowLabels({ analysis }: { analysis?: FlowAnalysis | undefined }) {
  const t = useT(messages);
  const locale = useLocale();
  const kind = analysis?.structure;
  const name =
    kind === 'PARTIAL'
      ? t('partial')
      : kind === 'CUSTOM'
        ? t('custom')
        : kind == null || kind === 'UNKNOWN' || kind === 'UNLINKED'
          ? '—'
          : getStrategyLabel(kind, undefined, locale);
  return (
    <div className={styles.labels}>
      <span>
        <span className={styles.caption}>{t('structure')}</span>
        {name}
      </span>
      <span>
        <span className={styles.caption}>{t('side')}</span>
        {analysis ? t(analysis.executionSide) : '—'}
        {analysis?.sideBasis !== 'legs' && analysis ? (
          <small> · {t(analysis.sideBasis)}</small>
        ) : null}
      </span>
      <span className={styles.unknown}>
        <span className={styles.caption}>{t('position')}</span>
        {t('unknown')}
      </span>
    </div>
  );
}

export interface FlowEvidenceTarget {
  mode: 'live' | 'institutional';
  tradeUid: string;
  venue: string;
  underlying: string;
  instrument: string;
  timestamp: number;
}

export function FlowEvidencePanel({
  target,
  showLegs = true,
}: {
  target: FlowEvidenceTarget;
  showLegs?: boolean;
}) {
  const t = useT(messages);
  const params = new URLSearchParams({ ...target, timestamp: String(target.timestamp) });
  const { data, isPending, error } = useQuery({
    queryKey: ['flow-evidence', target.mode, target.venue, target.tradeUid, target.timestamp],
    queryFn: async () =>
      FlowEvidenceResponseSchema.parse(await fetchJson<unknown>(`/flow/evidence?${params}`)),
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.oi.some((item) => item.status === 'pending') ? 30_000 : false,
    retry: 1,
  });
  if (isPending)
    return (
      <div className={styles.panel} role="status">
        {t('loading')}
      </div>
    );
  if (error || !data)
    return (
      <div className={styles.panel} role="status">
        {t('failed')}
      </div>
    );
  const { analysis } = data;
  return (
    <section className={styles.panel} aria-label={t('detail')}>
      <FlowLabels analysis={analysis} />
      <div className={styles.provenance}>
        <span>{t(analysis.linkage)}</span>
        {analysis.linkage === 'exchange' ? (
          <span data-partial={analysis.completeness === 'partial'}>
            {analysis.completeness === 'unknown' ? t('incomplete') : t(analysis.completeness)}
          </span>
        ) : null}
      </div>
      <p className={styles.note}>
        {analysis.completeness === 'partial' ? `${t('partialNote')} ` : ''}
        {t('note')}
      </p>
      {analysis.issues.some((issue) => issue !== 'incomplete_group') ? (
        <p className={styles.note}>{t('unsupported')}</p>
      ) : null}
      <EvidenceFields evidence={data.evidence} />
      {showLegs && analysis.legs.length > 0 ? (
        <div className={styles.scroll}>
          <table className={styles.legTable}>
            <thead>
              <tr>
                <th>{t('action')}</th>
                <th>{t('instrument')}</th>
                <th>{t('quantity', { unit: target.underlying })}</th>
                <th>{t('position')}</th>
              </tr>
            </thead>
            <tbody>
              {analysis.legs.map((leg) => (
                <tr key={`${leg.instrument}:${leg.side}`}>
                  <td data-side={leg.side}>{t(leg.side)}</td>
                  <td>{leg.instrument}</td>
                  <td>{formatNumber(leg.quantity)}</td>
                  <td className={styles.unknown}>{t('unknown')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className={styles.oiHeading}>{t('oi')}</div>
      <div className={styles.oiGrid}>
        {data.oi.map((item) => (
          <OiCard key={item.instrument} context={item} />
        ))}
      </div>
      <p className={styles.note}>{t('oiNote')}</p>
    </section>
  );
}

function EvidenceFields({ evidence }: { evidence: ExchangeTradeEvidence | null }) {
  const t = useT(messages);
  if (!evidence || Object.values(evidence).every((value) => value == null))
    return <p className={styles.note}>{t('noEvidence')}</p>;
  const entries = [
    [t('block'), evidence.blockTradeId],
    [t('rfq'), evidence.rfqId],
    [t('combo'), evidence.comboId],
    [t('execution'), evidence.comboTradeId],
    [t('sequence'), evidence.tradeSequence],
    [t('liquidation'), evidence.liquidation ? t(evidence.liquidation) : undefined],
  ];
  return (
    <dl className={styles.fields}>
      {entries
        .filter(([, value]) => value != null)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      {evidence.impliedTaker ? (
        <div>
          <dt>{t('implied')}</dt>
          <dd>✓</dd>
        </div>
      ) : null}
    </dl>
  );
}

function OiCard({ context }: { context: FlowOiContext }) {
  const t = useT(messages);
  return (
    <article className={styles.oiCard}>
      <div className={styles.oiInstrument}>{context.instrument}</div>
      <div className={styles.oiStatus} data-gap={context.status !== 'bracketed'}>
        {t(context.status)}
      </div>
      <div className={styles.oiDelta}>
        {t('delta')}:{' '}
        <strong>
          {context.delta == null
            ? '—'
            : `${context.delta > 0 ? '+' : ''}${formatNumber(context.delta)}`}
        </strong>
        {context.intervalMs != null ? (
          <span> / {t('minutes', { value: (context.intervalMs / 60_000).toFixed(1) })}</span>
        ) : null}
      </div>
      <dl className={styles.oiSamples}>
        {(['before', 'after'] as const).map((key) => (
          <div key={key}>
            <dt>{t(key)}</dt>
            <dd>
              {context[key] ? (
                <>
                  {formatNumber(context[key].openInterest)}{' '}
                  <time dateTime={new Date(context[key].timestamp).toISOString()}>
                    {new Date(context[key].timestamp).toLocaleString()}
                  </time>
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
