import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  FlowEvidenceResponseSchema,
  type ExchangeTradeEvidence,
  type FlowAnalysis,
  type FlowOiContext,
  type FlowPositionAssessment,
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
    unknown: 'Reconcile OI',
    inferred_open: 'Opening · inferred',
    inferred_close: 'Closing · inferred',
    partialEffect: 'Opening / closing components',
    mixedEffect: 'Opening + closing legs · inferred',
    inferred: 'inferred',
    buy_to_open: 'Buy to open',
    sell_to_open: 'Sell to open',
    buy_to_close: 'Buy to close',
    sell_to_close: 'Sell to close',
    opening_component: 'Opening ≥ {value}',
    closing_component: 'Closing ≥ {value}',
    offsetting: 'No net OI change',
    ambiguous: 'Other trades can explain OI',
    inconsistent: 'OI / tape mismatch',
    incompleteTape: 'Incomplete tape match',
    reconciling: 'Reconciling OI…',
    intervalVolume: 'Interval volume',
    otherVolume: 'Other volume',
    prints: '{value} prints',
    recorded: 'Recorded tape · completeness unverified',
    sequence_contiguous: 'Recorded sequences continuous · interval edges unverified',
    tapeGap: 'Trade sequence gap',
    truncated: 'Tape query limit reached',
    exchangeOi: 'Exchange-timestamped OI',
    sampledOi: 'Periodic OI snapshots',
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
    failed: 'Evidence unavailable in local capture.',
    detail: 'Trade evidence',
    note: 'Opening / closing is inferred by reconciling this execution with OI and all recorded trades in the interval. Legs are assessed separately.',
    instrument: 'Instrument',
    quantity: 'Quantity ({unit})',
    action: 'Action',
    oi: 'Open-interest context',
    oiNote:
      'Inferred results and minimum quantities assume complete tape coverage and current exchange OI. Reporting lag or missing prints can change the result. This is retrospective evidence, not account-level confirmation.',
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
    unknown: 'Conciliar OI',
    inferred_open: 'Apertura · inferida',
    inferred_close: 'Cierre · inferido',
    partialEffect: 'Componentes de apertura / cierre',
    mixedEffect: 'Patas de apertura + cierre · inferidas',
    inferred: 'inferido',
    buy_to_open: 'Compra para abrir',
    sell_to_open: 'Venta para abrir',
    buy_to_close: 'Compra para cerrar',
    sell_to_close: 'Venta para cerrar',
    opening_component: 'Apertura ≥ {value}',
    closing_component: 'Cierre ≥ {value}',
    offsetting: 'Sin cambio neto de OI',
    ambiguous: 'Otros trades pueden explicar el OI',
    inconsistent: 'OI y tape no coinciden',
    incompleteTape: 'Tape incompleto para conciliar',
    reconciling: 'Conciliando OI…',
    intervalVolume: 'Volumen del intervalo',
    otherVolume: 'Otro volumen',
    prints: '{value} prints',
    recorded: 'Tape registrado · integridad no verificada',
    sequence_contiguous: 'Secuencias continuas · extremos del intervalo no verificados',
    tapeGap: 'Hueco en la secuencia de trades',
    truncated: 'Límite de consulta alcanzado',
    exchangeOi: 'OI con hora del exchange',
    sampledOi: 'Muestras periódicas de OI',
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
    failed: 'Evidencia no disponible en la captura local.',
    detail: 'Evidencia del trade',
    note: 'La apertura / cierre se infiere conciliando esta ejecución con el OI y todos los trades registrados en el intervalo. Cada pata se evalúa por separado.',
    instrument: 'Instrumento',
    quantity: 'Cantidad ({unit})',
    action: 'Acción',
    oi: 'Contexto de interés abierto',
    oiNote:
      'Los resultados inferidos y cantidades mínimas suponen un tape completo y OI actualizado. Las demoras o prints faltantes pueden cambiar el resultado. Es evidencia retrospectiva, no confirmación de una cuenta.',
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
        {analysis?.legs.length === 1 ? (
          <PositionVerdict position={analysis.legs[0]?.position} />
        ) : analysis?.positionEffect === 'inferred_open' ||
          analysis?.positionEffect === 'inferred_close' ? (
          t(analysis.positionEffect)
        ) : analysis?.positionEffect === 'mixed' ? (
          t('mixedEffect')
        ) : analysis?.positionEffect === 'partial' ? (
          t('partialEffect')
        ) : (
          <PositionVerdict position={analysis?.legs[0]?.position} />
        )}
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

function useFlowEvidence(target: FlowEvidenceTarget, enabled = true) {
  const params = new URLSearchParams({ ...target, timestamp: String(target.timestamp) });
  return useQuery({
    queryKey: ['flow-evidence', target.mode, target.venue, target.tradeUid, target.timestamp],
    queryFn: async () =>
      FlowEvidenceResponseSchema.parse(await fetchJson<unknown>(`/flow/evidence?${params}`)),
    enabled,
    staleTime: 30_000,
    refetchInterval: () =>
      enabled && target.timestamp > Date.now() - 30 * 60_000 ? 30_000 : false,
    retry: 1,
  });
}

export function FlowRowLabels({
  target,
  analysis,
}: {
  target: FlowEvidenceTarget;
  analysis?: FlowAnalysis | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const t = useT(messages);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const { data, isFetching, error } = useFlowEvidence(target, visible);
  return (
    <div ref={ref}>
      <FlowLabels analysis={data?.analysis ?? analysis} />
      {!data && isFetching ? (
        <small>{t('reconciling')}</small>
      ) : error ? (
        <small>{t('failed')}</small>
      ) : null}
    </div>
  );
}

function PositionVerdict({ position }: { position?: FlowPositionAssessment | undefined }) {
  const t = useT(messages);
  if (!position) return <span>{t('unknown')}</span>;
  const { status, action } = position;
  return (
    <span className={styles.verdict} data-effect={status}>
      {action ? (
        <>
          {t(action)} <small>· {t('inferred')}</small>
        </>
      ) : status === 'opening_component' ? (
        <>{t(status, { value: formatNumber(position.minOpening ?? 0) })} <small>· {t('inferred')}</small></>
      ) : status === 'closing_component' ? (
        <>{t(status, { value: formatNumber(position.minClosing ?? 0) })} <small>· {t('inferred')}</small></>
      ) : status === 'incomplete' ? (
        t('incompleteTape')
      ) : (
        t(status)
      )}
    </span>
  );
}

export function FlowEvidencePanel({
  target,
  showLegs = true,
}: {
  target: FlowEvidenceTarget;
  showLegs?: boolean;
}) {
  const t = useT(messages);
  const { data, isPending, error } = useFlowEvidence(target);
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
                  <td>
                    <PositionVerdict position={leg.position} />
                    {leg.position?.intervalVolume != null ? (
                      <div className={styles.calculation}>
                        {t('intervalVolume')}: {formatNumber(leg.position.intervalVolume)} ·{' '}
                        {t('prints', { value: leg.position.tradeCount })}
                        {leg.position.otherVolume != null ? (
                          <>
                            {' '}
                            · {t('otherVolume')}: {formatNumber(leg.position.otherVolume)}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
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
      <div className={styles.calculation}>
        {t(context.timing === 'exchange' ? 'exchangeOi' : 'sampledOi')}
        {' · '}
        {t(
          context.tradeCoverage === 'sequence_contiguous'
            ? 'sequence_contiguous'
            : context.tradeCoverage === 'gap'
              ? 'tapeGap'
              : context.tradeCoverage === 'truncated'
                ? 'truncated'
                : 'recorded',
        )}
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
