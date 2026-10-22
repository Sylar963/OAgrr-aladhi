import { useCallback } from 'react';
import { create } from 'zustand';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

const STORAGE_KEY = 'locale';

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es';
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // storage unavailable: fall back to the browser language
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) {
    return 'es';
  }
  return 'en';
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => {
  const initial = detectLocale();
  applyDocumentLang(initial);
  return {
    locale: initial,
    setLocale: (locale) => {
      try {
        localStorage.setItem(STORAGE_KEY, locale);
      } catch {
        // storage unavailable: the choice lasts for this page load only
      }
      applyDocumentLang(locale);
      set({ locale });
    },
  };
});

export function useLocale(): Locale {
  return useLocaleStore((s) => s.locale);
}

export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}

/** BCP 47 tag for Intl/toLocale* date and text formatting. Numbers stay en-US app-wide. */
export function intlLocale(locale: Locale = getLocale()): string {
  return locale === 'es' ? 'es-419' : 'en-US';
}

export type Messages = Record<string, string>;
export type Vars = Record<string, string | number>;

export interface MessageBundle<M extends Messages> {
  en: M;
  es: { [K in keyof M]: string };
}

/** English is the source of truth; the Spanish map must carry exactly the same keys. */
export function defineMessages<M extends Messages>(
  en: M,
  es: { [K in keyof M]: string },
): MessageBundle<M> {
  return { en, es };
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type Translate<M extends Messages> = (key: keyof M & string, vars?: Vars) => string;

export function translate<M extends Messages>(
  bundle: MessageBundle<M>,
  key: keyof M & string,
  vars?: Vars,
  locale: Locale = getLocale(),
): string {
  return interpolate(bundle[locale][key] ?? bundle.en[key] ?? key, vars);
}

export function useT<M extends Messages>(bundle: MessageBundle<M>): Translate<M> {
  const locale = useLocale();
  return useCallback(
    (key: keyof M & string, vars?: Vars) => translate(bundle, key, vars, locale),
    [bundle, locale],
  );
}
