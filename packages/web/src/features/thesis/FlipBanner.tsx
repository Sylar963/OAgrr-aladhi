import type { ThesisView } from '@oggregator/protocol';
import { useState } from 'react';

import { backToThesis } from './api';
import FlipForm from './FlipForm';
import { fmtPrice } from './format';
import { useTheses, useThesisRefresh } from './hooks';
import styles from './Thesis.module.css';

function fmtWhen(ms: number): string {
  return new Date(ms)
    .toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .toUpperCase();
}

function FlipBannerItem({ view }: { view: ThesisView }) {
  const refresh = useThesisRefresh();
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flip = view.pendingFlip;
  if (flip == null) return null;
  const { thesis } = view;

  return (
    <div className={styles.banner} role="alert">
      <div>
        Your {thesis.underlying} {flip.source} book turned {flip.classification} against your intact{' '}
        {thesis.direction} thesis (detected {fmtWhen(flip.detectedAt)}).{' '}
        {flip.backToThesis
          ? `Waiting for the book to return to ${thesis.direction}.`
          : `You wrote: wrong only if price closes ${thesis.direction === 'bearish' ? 'above' : 'below'} ${fmtPrice(thesis.level)}.`}
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
            Log it as a flip
          </button>
          {!flip.backToThesis && (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() =>
                void backToThesis(thesis.id)
                  .then(() => refresh())
                  .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Request failed'))
              }
            >
              Back to my thesis
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
