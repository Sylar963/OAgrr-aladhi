import { useEffect, useRef, useState } from 'react';

import styles from './FlashingPrice.module.css';

// After a context switch the cached chain is replaced by REST + WS snapshots in
// quick succession; those are re-syncs, not ticks, so they must not flash.
const SETTLE_MS = 1_500;

interface FlashingPriceProps {
  text: string;
  className?: string;
  /** Identity of the quote being shown (e.g. underlying + tenor). Text changes
   * caused by a scope change, or shortly after it, never flash. */
  scope?: string;
}

export function FlashingPrice({ text, className, scope }: FlashingPriceProps) {
  const previousRef = useRef<{ text: string; scope: string | undefined } | null>(null);
  const settleUntilRef = useRef(0);
  const [flashVersion, setFlashVersion] = useState(0);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { text, scope };

    if (previous == null || previous.scope !== scope) {
      settleUntilRef.current = Date.now() + SETTLE_MS;
      return;
    }
    if (
      previous.text === '–' ||
      text === '–' ||
      previous.text === text ||
      Date.now() < settleUntilRef.current
    ) {
      return;
    }

    setFlashVersion((version) => version + 1);
  }, [text, scope]);

  const classNames = [styles.price, flashVersion > 0 ? styles.flash : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span key={flashVersion} className={classNames}>
      {text}
    </span>
  );
}
