import { fmtPct, fmtUsdPrice } from '@lib/format';
import { useT } from '@lib/i18n';
import styles from './EasyChain.module.css';
import { type EasyBuyPreview, fmtTollMove } from './easy-toll';
import { easyMessages } from './i18n';

interface EasyTollPreviewProps {
  preview: EasyBuyPreview | null;
  underlying: string;
}

export default function EasyTollPreview({ preview, underlying }: EasyTollPreviewProps) {
  const t = useT(easyMessages);
  if (!preview)
    return (
      <section className={styles.tollPreview} aria-label={t('tollPreview')}>
        <span className={styles.tollEyebrow}>{t('tollPreview')}</span>
        <p className={styles.tollNote}>{t('tollChoose')}</p>
      </section>
    );
  const { toll } = preview;
  return (
    <section className={styles.tollPreview} aria-label={t('tollPreview')}>
      <div className={styles.tollHeader}>
        <span className={styles.tollEyebrow}>
          {t('buyPreview', {
            type: preview.type.toUpperCase(),
            strike: fmtUsdPrice(preview.strike),
          })}
          <span className={styles.tollVenue}>{preview.venue}</span>
        </span>
        <span className={styles.tollMove}>
          {t('moveToBe', { underlying })} <b>{fmtPct(preview.movePct)}</b>
        </span>
      </div>
      <div className={styles.tollLevels}>
        <div>
          <span>{t('target')}</span>
          <b>{fmtUsdPrice(preview.strike)}</b>
        </div>
        <div>
          <span>{t('midBe')}</span>
          <b>{toll ? fmtUsdPrice(toll.breakeven) : '–'}</b>
        </div>
        <div data-tone="toll">
          <span>{t('buyBe')}</span>
          <b>{fmtUsdPrice(preview.breakeven)}</b>
        </div>
      </div>
      <div className={styles.tollRail} aria-hidden="true" data-unavailable={!toll}>
        <span style={{ flex: toll?.mid ?? preview.ask }} />
        {toll != null && toll.usd > 0 && <span style={{ flex: toll.usd }} />}
      </div>
      <div className={styles.tollBreakdown}>
        <span>{t('premiumToRecover', { price: fmtUsdPrice(preview.ask) })}</span>
        <b>
          {toll
            ? t('extraTollMove', {
                price: fmtUsdPrice(toll.usd),
                move: fmtTollMove(toll.movePct),
              })
            : t('tollUnavailable')}
        </b>
      </div>
      <p className={styles.tollNote}>{t(toll ? 'tollBasis' : 'tollMissingBasis')}</p>
    </section>
  );
}
