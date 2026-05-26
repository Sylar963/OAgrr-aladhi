import { useIsMobile } from '@hooks/useIsMobile';
import { useAppStore } from '@stores/app-store';
import { useEffect, useState } from 'react';
import styles from './TourSpotlight.module.css';
import { TOUR_STEPS } from './tour-steps';

const TOOLTIP_WIDTH = 280;
// Upper-bound estimate of tooltip height; used to keep it clear of the bottom edge.
const TOOLTIP_MAX_HEIGHT = 200;
const GAP = 12;

export default function TourSpotlight() {
  const tourActive = useAppStore((s) => s.tourActive);
  const tourStep = useAppStore((s) => s.tourStep);
  const nextStep = useAppStore((s) => s.nextStep);
  const prevStep = useAppStore((s) => s.prevStep);
  const endTour = useAppStore((s) => s.endTour);
  const isMobile = useIsMobile();
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = TOUR_STEPS[tourStep];
  const isLast = tourStep === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!tourActive || isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourActive, isMobile, endTour]);

  useEffect(() => {
    if (!tourActive || isMobile || step == null) return;
    if (step.target == null) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el == null) {
      // Target not present on this layout — skip past it (or end on the last step).
      if (isLast) endTour();
      else nextStep();
      return;
    }
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [tourActive, isMobile, step, tourStep, isLast, nextStep, endTour]);

  if (!tourActive || isMobile || step == null) return null;

  const centered = step.target == null || rect == null;
  const onNext = () => (isLast ? endTour() : nextStep());

  const tooltipStyle = centered
    ? undefined
    : {
        top: Math.min(rect.bottom + GAP, window.innerHeight - TOOLTIP_MAX_HEIGHT - GAP),
        left: Math.max(GAP, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - GAP)),
      };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={step.title}>
      {centered ? (
        <div className={styles.backdrop} />
      ) : (
        <div
          className={styles.ring}
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        className={centered ? `${styles.tooltip} ${styles.tooltipCentered}` : styles.tooltip}
        style={tooltipStyle}
      >
        <div className={styles.tipTitle}>{step.title}</div>
        <p className={styles.tipBody}>{step.body}</p>
        <div className={styles.tipFooter}>
          <span className={styles.dots} aria-label={`Step ${tourStep + 1} of ${TOUR_STEPS.length}`}>
            {TOUR_STEPS.map((s, i) => (
              <span
                key={s.title}
                className={i === tourStep ? styles.dotActive : styles.dot}
                aria-hidden="true"
              />
            ))}
          </span>
          <span className={styles.tipActions}>
            <button type="button" className={styles.skipBtn} onClick={endTour}>
              Skip
            </button>
            {tourStep > 0 && (
              <button type="button" className={styles.navBtn} onClick={prevStep}>
                Back
              </button>
            )}
            <button
              type="button"
              className={`${styles.navBtn} ${styles.navBtnPrimary}`}
              onClick={onNext}
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
