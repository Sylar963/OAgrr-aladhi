import { LOCALES, useLocaleStore } from '@lib/i18n';

import styles from './AssetModeToggle.module.css';

const LABELS = {
  en: { short: 'EN', title: 'English' },
  es: { short: 'ES', title: 'Español' },
} as const;

export default function LanguageToggle() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Language / Idioma">
      {LOCALES.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          lang={id}
          className={styles.option}
          aria-checked={locale === id}
          title={LABELS[id].title}
          onClick={() => setLocale(id)}
        >
          {LABELS[id].short}
        </button>
      ))}
    </div>
  );
}
