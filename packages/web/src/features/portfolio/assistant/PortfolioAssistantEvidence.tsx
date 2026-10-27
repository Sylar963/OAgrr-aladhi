import type { PortfolioAssistantAction, PortfolioAssistantEvidence as Evidence } from '@oggregator/protocol';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import styles from './PortfolioAssistantPanel.module.css';

const messages = defineMessages({
  evidence: 'Evidence & assumptions', snapshot: 'Portfolio snapshot', scope: 'Context supplied', positions: 'Positions in context',
  noPositions: 'No position-specific evidence.', mark: 'Mark', quote: 'Mark timestamp', unknown: 'Unavailable',
  mark_not_execution: 'Marks are indicative valuations, not executable fills.',
  constant_iv_scenarios: 'Horizon scenarios hold IV constant and measure P&L versus entry.',
  expiry_not_margin: 'Expiry loss bounds do not establish intraday margin or liquidation limits.',
  snapshot_not_quote_time: 'The snapshot time is the calculation time, not proof that every quote is fresh.',
  changes_not_attribution: 'Differences are measured between snapshots; they do not establish what caused the P&L change.',
  risk_neutral_not_forecast: 'Market-implied probabilities and levels are model estimates, not validated forecasts.',
  gaps: 'Data gaps', truncated: 'Position list is incomplete; additions and removals cannot be compared reliably.',
  previous: 'Previous review', metric: 'Metric', before: 'Before', now: 'Now', change: 'Change',
  spotUsd: 'Spot ($)', unrealizedPnlUsd: 'Unrealized P&L ($)', netDeltaCoin: 'Delta (coin)', netThetaUsd: 'Theta ($/day)', netVegaUsd: 'Vega ($/vol pt)', equityUsd: 'Equity ($)',
  holdings: 'Observed size changes', unchanged: 'No size changes in the captured option positions.',
  markChanges: 'Mark P&L change · unchanged holdings', residual: 'Unattributed P&L change', valuation: 'Quantity × mark change for unchanged instruments, sizes and entry prices. This does not isolate delta, theta or IV effects.',
  viewPositions: 'View affected positions', scenario: 'Open scenario', alternatives: 'Compare alternatives',
  portfolio: 'Portfolio', scenarios: 'Scenarios', market: 'Market', trades: 'Fills', account: 'Account ledger',
  fresh: 'Snapshot current at capture', partial: 'Partial inputs', stale: 'Snapshot stale at capture',
  legacy: 'This answer predates saved evidence. Ask again to capture a new snapshot.',
}, {
  evidence: 'Evidencia y supuestos', snapshot: 'Snapshot del portafolio', scope: 'Contexto proporcionado', positions: 'Posiciones en contexto',
  noPositions: 'Sin evidencia específica de posiciones.', mark: 'Mark', quote: 'Hora del mark', unknown: 'No disponible',
  mark_not_execution: 'Los marks son valoraciones indicativas, no fills ejecutables.',
  constant_iv_scenarios: 'Los escenarios mantienen la IV constante y miden P&L desde la entrada.',
  expiry_not_margin: 'Los límites de pérdida al vencimiento no establecen límites de margen o liquidación intradía.',
  snapshot_not_quote_time: 'La hora del snapshot es la del cálculo; no demuestra que todas las cotizaciones estén actualizadas.',
  changes_not_attribution: 'Las diferencias se miden entre snapshots; no demuestran la causa del cambio de P&L.',
  risk_neutral_not_forecast: 'Las probabilidades y niveles implícitos son estimaciones del modelo, no pronósticos validados.',
  gaps: 'Datos faltantes', truncated: 'La lista de posiciones está incompleta; no se pueden comparar altas y bajas de forma fiable.',
  previous: 'Revisión anterior', metric: 'Métrica', before: 'Antes', now: 'Ahora', change: 'Cambio',
  spotUsd: 'Spot ($)', unrealizedPnlUsd: 'P&L no realizado ($)', netDeltaCoin: 'Delta (coin)', netThetaUsd: 'Theta ($/día)', netVegaUsd: 'Vega ($/punto vol)', equityUsd: 'Equity ($)',
  holdings: 'Cambios de tamaño observados', unchanged: 'Sin cambios de tamaño en las posiciones de opciones capturadas.',
  markChanges: 'Cambio de P&L por mark · posiciones sin cambios', residual: 'Cambio de P&L sin atribuir', valuation: 'Cantidad × cambio de mark para instrumentos, tamaños y precios de entrada sin cambios. No separa los efectos de delta, theta o IV.',
  viewPositions: 'Ver posiciones afectadas', scenario: 'Abrir escenario', alternatives: 'Comparar alternativas',
  portfolio: 'Portafolio', scenarios: 'Escenarios', market: 'Mercado', trades: 'Fills', account: 'Ledger de cuenta',
  fresh: 'Snapshot actual al capturarse', partial: 'Datos parciales', stale: 'Snapshot desactualizado al capturarse',
  legacy: 'Esta respuesta es anterior a la evidencia guardada. Pregunta de nuevo para capturar un snapshot.',
});

export type AssistantActionHandler = (action: PortfolioAssistantAction, evidence: Evidence) => void;

export function PortfolioAssistantEvidence({ evidence, generatedAt, onAction, disabled }: {
  evidence: Evidence | null | undefined;
  generatedAt: number | null;
  onAction?: AssistantActionHandler;
  disabled?: boolean;
}) {
  const t = useT(messages);
  const locale = useLocale();
  const date = (value: number) => new Date(value).toLocaleString(locale, { timeZoneName: 'short' });
  const number = (value: number | null) => value == null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 4 });
  const snapshot = evidence?.snapshot;
  const legs = snapshot?.positions.filter((leg) => evidence?.relevantLegIds.includes(leg.legId)) ?? [];
  return (
    <div className={styles.answerEvidence}>
      <details>
        <summary>{t('evidence')}</summary>
        <p>{t('snapshot')}: {generatedAt == null ? t('unknown') : date(generatedAt)}</p>
        {evidence && snapshot ? <>
          <p>{snapshot.source} · {snapshot.underlying ?? 'ALL'} · T+{snapshot.forwardDays}d · {t(snapshot.dataState)}</p>
          <p>{t('scope')}: {evidence.contextSections.map((section) => t(section)).join(', ')}</p>
          <strong>{t('positions')}</strong>
          {legs.length === 0 ? <p>{t('noPositions')}</p> : <ul>{legs.map((leg) => <li key={leg.legId}>
            {leg.underlying} {leg.expiry} · {number(leg.strike)} {leg.optionRight} · {number(leg.size)}<br />
            {t('mark')}: {leg.markUsd == null ? t('unknown') : `$${number(leg.markUsd)}`} · {t('quote')}: {leg.markUpdatedAt == null ? t('unknown') : date(leg.markUpdatedAt)}
          </li>)}</ul>}
          {snapshot.positionsTruncated && <p>{t('truncated')}</p>}
          <ul>{evidence.assumptions.map((item) => <li key={item}>{t(item)}</li>)}</ul>
          {evidence.gaps.length > 0 && <><strong>{t('gaps')}</strong><ul>{evidence.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul></>}
          {evidence.comparison && <>
            <strong>{t('previous')}: {date(evidence.comparison.previousGeneratedAt)}</strong>
            <div className={styles.evidenceTable}><table>
              <thead><tr><th>{t('metric')}</th><th>{t('before')}</th><th>{t('now')}</th><th>{t('change')}</th></tr></thead>
              <tbody>{evidence.comparison.changes.map((row) => <tr key={row.metric}><th>{t(row.metric)}</th><td>{number(row.previous)}</td><td>{number(row.current)}</td><td>{number(row.change)}</td></tr>)}</tbody>
            </table></div>
            {(evidence.comparison.markPnlChanges?.length ?? 0) > 0 && <><strong>{t('markChanges')}</strong>
              <ul>{evidence.comparison.markPnlChanges?.map((leg) => <li key={leg.legId}>{leg.instrument}: ${number(leg.pnlChangeUsd)}</li>)}</ul><p>{t('valuation')}</p></>}
            <p>{t('residual')}: {evidence.comparison.unattributedPnlChangeUsd == null ? t('unknown') : `$${number(evidence.comparison.unattributedPnlChangeUsd)}`}</p>
            <strong>{t('holdings')}</strong>
            {!evidence.comparison.positionsComparable ? <p>{t('truncated')}</p> : evidence.comparison.positionChanges.length === 0 ? <p>{t('unchanged')}</p>
              : <ul>{evidence.comparison.positionChanges.map((leg) => <li key={leg.legId}>{leg.instrument}: {number(leg.previousSize)} → {number(leg.currentSize)}</li>)}</ul>}
          </>}
        </> : <p>{t('legacy')}</p>}
      </details>
      {evidence && onAction && <div className={styles.resultActions}>
        {evidence.actions.map((action) => <button type="button" key={action} disabled={disabled} onClick={() => onAction(action, evidence)}>
          {t(action === 'positions' ? 'viewPositions' : action === 'scenario' ? 'scenario' : 'alternatives')}
        </button>)}
      </div>}
    </div>
  );
}
