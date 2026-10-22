import type { ThesisView } from '@oggregator/protocol';
import { intlLocale, type Locale, useLocale, useT } from '@lib/i18n';
import { useState } from 'react';

import { backToThesis } from './api';
import FlipForm from './FlipForm';
import { classificationLabel, fmtPrice } from './format';
import { useTheses, useThesisRefresh } from './hooks';
import { thesisMessages } from './i18n';
import styles from './Thesis.module.css';

function fmtWhen(ms: number, locale: Locale): string {
  return new Date(ms)
    .toLocaleString(locale === 'en' ? 'en-GB' : intlLocale(locale), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(/\./g, '')
    .toUpperCase();
}

function FlipBannerItem({ view }: { view: ThesisView }) {
  const t = useT(thesisMessages);
  const locale = useLocale();
  const refresh = useThesisRefresh();
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flip = view.pendingFlip;
  if (flip == null) return null;
  const { thesis } = view;

  return (
    <div className={styles.banner} role="alert">
      <div>
        {t('bannerBookTurned', {
          underlying: thesis.underlying,
          source: flip.source,
          classification: classificationLabel(flip.classification, locale),
          direction: classificationLabel(thesis.direction, locale),
          when: fmtWhen(flip.detectedAt, locale),
        })}{' '}
        {flip.backToThesis
          ? t('bannerWaiting', { direction: classificationLabel(thesis.direction, locale) })
          : t(thesis.direction === 'bearish' ? 'bannerWroteAbove' : 'bannerWroteBelow', {
              level: fmtPrice(thesis.level),
            })}
      </div>
      {error && <div className={styles.error}>{error}</div>}
      {logging ? (
        <FlipForm
          thesis={thesis}
          needsConfirmation={!view.waitCompleted}
          late
          initialLevel=""
          expiryOptions={[]}
          spotUsd={view.status.spotUsd}
          onCancel={() => setLogging(false)}
          onDone={() => setLogging(false)}
        />
      ) : (
        <div className={styles.actions}>
          <button type="button" className={styles.ghostBtn} onClick={() => setLogging(true)}>
            {t('logAsFlip')}
          </button>
          {!flip.backToThesis && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() =>
                void backToThesis(thesis.id)
                  .then(() => refresh())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : t('requestFailed')))
              }
            >
              {t('backToThesis')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Held-book flips the server detected against an intact thesis. */
export default function FlipBanner({ underlying }: { underlying?: string | null }) {
  const { data } = useTheses();
  const views =
    data?.active.filter(
      (view) => view.pendingFlip != null && (underlying == null || view.thesis.underlying === underlying),
    ) ?? [];
  if (views.length === 0) return null;
  return (
    <div className={styles.bannerStack}>
      {views.map((view) => (
        <FlipBannerItem key={view.thesis.id} view={view} />
      ))}
    </div>
  );
}
