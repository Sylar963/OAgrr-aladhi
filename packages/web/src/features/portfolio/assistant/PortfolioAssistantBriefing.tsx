import type { PortfolioMetrics, PositionLeg } from '@oggregator/protocol';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import styles from './PortfolioAssistantPanel.module.css';

const messages = defineMessages({
  title: 'Your portfolio, at a glance', netDelta: 'Net delta', theta: 'Theta / day', nextExpiry: 'Next expiry',
  unknown: 'Unavailable', loading: 'Waiting for portfolio analytics.', empty: 'No option positions in this view.',
  missing: '{n} positions have no mark. P&L may be incomplete.',
  thetaPrompt: 'Explain the theta contribution of expiry {expiry}.',
  expiryPrompt: 'What should I review before expiry {expiry}?',
  gapsPrompt: 'Which positions have missing marks, and how does that affect my P&L?',
  stressPrompt: 'Stress my {underlying} portfolio at a −5% spot move over {days} days. State the IV and cost assumptions.',
  mixedPrompt: 'Explain the largest exposures separately for each underlying in my portfolio.',
  learnPrompt: 'Explain gamma',
}, {
  title: 'Tu portafolio, de un vistazo', netDelta: 'Delta neta', theta: 'Theta / día', nextExpiry: 'Próximo vencimiento',
  unknown: 'No disponible', loading: 'Esperando la analítica del portafolio.', empty: 'No hay posiciones de opciones en esta vista.',
  missing: '{n} posiciones no tienen mark. El P&L puede estar incompleto.',
  thetaPrompt: 'Explica la contribución de theta del vencimiento {expiry}.',
  expiryPrompt: '¿Qué debo revisar antes del vencimiento {expiry}?',
  gapsPrompt: '¿Qué posiciones no tienen mark y cómo afecta eso a mi P&L?',
  stressPrompt: 'Evalúa mi portafolio de {underlying} con una caída del spot de 5% en {days} días. Indica los supuestos de IV y costos.',
  mixedPrompt: 'Explica las mayores exposiciones por separado para cada subyacente de mi portafolio.',
  learnPrompt: 'Explica gamma',
});

export function portfolioBriefing(metrics: PortfolioMetrics | null, positions: PositionLeg[]) {
  const marks = new Map(metrics?.breakEven.map((row) => [row.legId, row.currentMarkUsd]));
  const missingMarks = metrics == null ? null : positions.filter((leg) => marks.get(leg.legId) == null).length;
  const nearestExpiry = positions.map((leg) => leg.expiry).sort()[0] ?? null;
  const thetaExpiry = [...(metrics?.byExpiry ?? [])].sort((a, b) => a.theta - b.theta)[0];
  const underlyings = [...new Set(positions.map((leg) => leg.underlying))];
  return { missingMarks, nearestExpiry, thetaExpiry, underlyings };
}

export function PortfolioAssistantBriefing({ metrics, positions, forwardDays, disabled, onSend }: {
  metrics: PortfolioMetrics | null;
  positions: PositionLeg[];
  forwardDays: number;
  disabled: boolean;
  onSend: (prompt: string) => void;
}) {
  const t = useT(messages);
  const locale = useLocale();
  const facts = portfolioBriefing(metrics, positions);
  const format = (value: number | null | undefined, digits = 2) => value == null
    ? t('unknown') : value.toLocaleString(locale, { maximumFractionDigits: digits });
  const prompts: string[] = [];
  if (facts.missingMarks) prompts.push(t('gapsPrompt'));
  if (facts.thetaExpiry && facts.thetaExpiry.theta < 0) prompts.push(t('thetaPrompt', { expiry: facts.thetaExpiry.expiry }));
  if (facts.nearestExpiry) prompts.push(t('expiryPrompt', { expiry: facts.nearestExpiry }));
  if (positions.length > 0) prompts.push(facts.underlyings.length === 1
    ? t('stressPrompt', { underlying: facts.underlyings[0]!, days: forwardDays }) : t('mixedPrompt'));
  else prompts.push(t('learnPrompt'));
  return (
    <div className={styles.briefing}>
      <p className={styles.briefingTitle}>{t('title')}</p>
      {metrics == null ? <p>{t('loading')}</p> : positions.length === 0 ? <p>{t('empty')}</p> : (
        <dl className={styles.briefingMetrics}>
          <div><dt>{t('netDelta')}</dt><dd>{facts.underlyings.length > 1 ? '—' : format(metrics.totals.netDeltaCoin, 4)} {facts.underlyings.length === 1 ? facts.underlyings[0] : ''}</dd></div>
          <div><dt>{t('theta')}</dt><dd>{metrics.totals.netThetaUsd == null ? t('unknown') : `$${format(metrics.totals.netThetaUsd)}`}</dd></div>
          <div><dt>{t('nextExpiry')}</dt><dd>{facts.nearestExpiry ?? '—'}</dd></div>
        </dl>
      )}
      {!!facts.missingMarks && <p className={styles.briefingWarning}>{t('missing', { n: facts.missingMarks })}</p>}
      <div className={styles.suggestions}>
        {prompts.slice(0, 3).map((prompt) => <button type="button" key={prompt} disabled={disabled} onClick={() => onSend(prompt)}>{prompt}<span aria-hidden="true"> ↗</span></button>)}
      </div>
    </div>
  );
}
