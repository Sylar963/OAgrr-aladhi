import type { Leg, StrategyMetrics } from '@features/architect';
import { fmtUsd } from '@lib/format';
import { useLocale, useT } from '@lib/i18n';
import { describeLeg, describeStrategy, legTitle } from './easy-explain';
import { easyMessages } from './i18n';
import styles from './EasyChain.module.css';

interface EasyPositionPanelProps {
  underlying: string;
  legs: Leg[];
  metrics: StrategyMetrics | null;
  strategyName: string;
  chance: number | null;
  mixedExpiries: boolean;
  notice: string | null;
  onQuantity: (leg: Leg, quantity: number) => void;
  onFlip: (leg: Leg) => void;
  onRemove: (leg: Leg) => void;
  onClear: () => void;
  onOpenBuilder: () => void;
}

function fmtBound(v: number | null, unbounded: string): string {
  return v == null ? unbounded : fmtUsd(Math.abs(v));
}

export default function EasyPositionPanel({
  underlying,
  legs,
  metrics,
  strategyName,
  chance,
  mixedExpiries,
  notice,
  onQuantity,
  onFlip,
  onRemove,
  onClear,
  onOpenBuilder,
}: EasyPositionPanelProps) {
  const t = useT(easyMessages);
  const locale = useLocale();
  if (legs.length === 0) {
    return (
      <div className={styles.panel}>
        {notice && <div className={styles.notice}>{notice}</div>}
        <ol className={styles.steps}>
          <li>
            <b>{t('step1Title')}</b> {t('step1Use')} <span data-side="up">{t('legUp')}</span>{' '}
            {t('step1UpList', { underlying })} <span data-side="down">{t('legDown')}</span>{' '}
            {t('step1DownList')}
          </li>
          <li>
            <b>{t('step2Title')}</b> {t('step2Body')} <em>{t('odds')}</em> {t('step2Odds')}
          </li>
          <li>
            <b>{t('step3Title')}</b> {t('step3Body')}
          </li>
        </ol>
      </div>
    );
  }

  const debit = metrics ? -metrics.netDebit : 0;
  const maxLossUnbounded = metrics != null && metrics.maxLoss == null;

  return (
    <div className={styles.panel}>
      {notice && <div className={styles.notice}>{notice}</div>}

      <div className={styles.summary}>
        <div className={styles.summaryHead}>
          <div className={styles.strategyName}>{strategyName}</div>
          <div className={styles.strategyBlurb}>{describeStrategy(strategyName, locale)}</div>
        </div>
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <span>{debit >= 0 ? t('youPay') : t('youReceive')}</span>
            <b>{fmtUsd(Math.abs(debit)) === '–' ? '$0' : fmtUsd(Math.abs(debit))}</b>
          </div>
          <div className={styles.kpi} data-tone="profit">
            <span>{t('maxWin')}</span>
            <b>{fmtBound(metrics?.maxProfit ?? null, t('unlimited'))}</b>
          </div>
          <div className={styles.kpi} data-tone="loss" data-alert={maxLossUnbounded}>
            <span>{t('maxLose')}</span>
            <b>{fmtBound(metrics?.maxLoss ?? null, t('unlimitedWarn'))}</b>
          </div>
          <div className={styles.kpi}>
            <span>{t('breakeven')}</span>
            <b>
              {metrics && metrics.breakevens.length > 0
                ? metrics.breakevens.map((b) => fmtUsd(b)).join(' / ')
                : '–'}
            </b>
          </div>
          <div className={styles.kpi}>
            <span title={t('chanceTip')}>{t('chance')}</span>
            <b>{chance != null ? `~${Math.round(chance * 100)}%` : '–'}</b>
          </div>
        </div>
      </div>

      {mixedExpiries && (
        <div className={styles.notice}>
          {t('mixedExpiries')}
        </div>
      )}
      {maxLossUnbounded && (
        <div className={styles.notice} data-tone="loss">
          {t('nakedWarning')}
        </div>
      )}

      <ul className={styles.legs}>
        {legs.map((leg) => (
          <li key={leg.id} className={styles.leg} data-side={leg.type === 'call' ? 'up' : 'down'}>
            <div className={styles.legTop}>
              <span className={styles.legTitle} data-direction={leg.direction}>
                {legTitle(leg, locale)}
              </span>
              <span className={styles.legMeta}>
                {t('each', { price: fmtUsd(leg.entryPrice), venue: leg.venue })}
              </span>
              <span className={styles.qty}>
                <button
                  type="button"
                  onClick={() => onQuantity(leg, leg.quantity - 1)}
                  disabled={leg.quantity <= 1}
                  aria-label={t('decrease')}
                >
                  −
                </button>
                <b>{leg.quantity}</b>
                <button
                  type="button"
                  onClick={() => onQuantity(leg, leg.quantity + 1)}
                  aria-label={t('increase')}
                >
                  +
                </button>
              </span>
              <button
                type="button"
                className={styles.flipBtn}
                onClick={() => onFlip(leg)}
                title={leg.direction === 'buy' ? t('switchToSell') : t('switchToBuy')}
              >
                {leg.direction === 'buy' ? t('flipToSell') : t('flipToBuy')}
              </button>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => onRemove(leg)}
                aria-label={t('removeOption')}
              >
                ✕
              </button>
            </div>
            <div className={styles.legText}>{describeLeg(leg, underlying, locale)}</div>
          </li>
        ))}
      </ul>

      <div className={styles.panelActions}>
        <button type="button" className={styles.ghostBtn} onClick={onClear}>
          {t('clear')}
        </button>
        <button type="button" className={styles.primaryBtn} onClick={onOpenBuilder}>
          {t('openBuilder')}
        </button>
      </div>
    </div>
  );
}
