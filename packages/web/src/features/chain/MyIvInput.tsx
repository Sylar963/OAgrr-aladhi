import { useEffect, useRef, useState } from 'react';

import { useAppStore } from '@stores/app-store';
import { defineMessages, useT } from '@lib/i18n';
import styles from './MyIvInput.module.css';

const DEBOUNCE_MS = 120;

const messages = defineMessages(
  {
    myIv: 'My IV',
    estimate: 'My IV estimate (%)',
    clear: 'Clear My IV',
    edgeActive: 'Edge column active',
    enterIv: 'Enter your IV to see edge',
  },
  {
    myIv: 'Mi IV',
    estimate: 'Mi estimación de IV (%)',
    clear: 'Borrar mi IV',
    edgeActive: 'Columna de edge activa',
    enterIv: 'Ingresa tu IV para ver el edge',
  },
);

export default function MyIvInput() {
  const t = useT(messages);
  const storeIv = useAppStore((s) => s.myIv);
  const setMyIv = useAppStore((s) => s.setMyIv);

  const [local, setLocal] = useState(storeIv);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(storeIv);
  }, [storeIv]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function onChange(value: string) {
    setLocal(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMyIv(value), DEBOUNCE_MS);
  }

  function onClear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLocal('');
    setMyIv('');
  }

  const hasValue = local !== '';

  return (
    <div className={styles.wrap} data-active={hasValue}>
      <span className={styles.label}>{t('myIv')}</span>
      <div className={styles.inputWrap}>
        <input
          type="number"
          className={styles.input}
          placeholder="—"
          value={local}
          min={0}
          max={500}
          step={0.1}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t('estimate')}
        />
        <span className={styles.pct}>%</span>
      </div>
      {hasValue && (
        <button className={styles.clear} onClick={onClear} aria-label={t('clear')}>
          ✕
        </button>
      )}
      <span className={styles.hint}>
        {hasValue ? t('edgeActive') : t('enterIv')}
      </span>
    </div>
  );
}
