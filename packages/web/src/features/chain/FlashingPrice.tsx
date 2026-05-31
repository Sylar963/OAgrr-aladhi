import { useEffect, useRef, useState } from 'react';

import styles from './FlashingPrice.module.css';

interface FlashingPriceProps {
  text: string;
  className?: string;
}

export function FlashingPrice({ text, className }: FlashingPriceProps) {
  const previousTextRef = useRef<string | null>(null);
  const [flashVersion, setFlashVersion] = useState(0);

  useEffect(() => {
    const previousText = previousTextRef.current;
    previousTextRef.current = text;

    if (previousText == null || previousText === '–' || text === '–' || previousText === text) {
      return;
    }

    setFlashVersion((version) => version + 1);
  }, [text]);

  const classNames = [styles.price, flashVersion > 0 ? styles.flash : null, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span key={flashVersion} className={classNames}>
      {text}
    </span>
  );
}
