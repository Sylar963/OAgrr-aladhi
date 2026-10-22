import { defineMessages, translate, useLocale, type Locale } from '@lib/i18n';

import styles from './StrategyIcon.module.css';

interface StrategyIconProps {
  strategy: string | null;
  size?: number;
}

// Payoff-shape SVG paths that traders recognize at a glance
const STRATEGY_PATHS: Record<string, string> = {
  CALL: 'M2,14 L10,14 L18,2',
  PUT: 'M2,2 L10,14 L18,14',
  STRADDLE: 'M2,2 L10,14 L18,2',
  STRANGLE: 'M2,2 L6,14 L14,14 L18,2',
  CALL_SPREAD: 'M2,14 L8,14 L12,4 L18,4',
  PUT_SPREAD: 'M2,4 L8,4 L12,14 L18,14',
  CALL_BUTTERFLY: 'M2,14 L6,14 L10,2 L14,14 L18,14',
  PUT_BUTTERFLY: 'M2,14 L6,14 L10,2 L14,14 L18,14',
  CALL_BUTTERFLY_SPREAD: 'M2,14 L6,14 L10,2 L14,14 L18,14',
  PUT_BUTTERFLY_SPREAD: 'M2,14 L6,14 L10,2 L14,14 L18,14',
  IRON_CONDOR: 'M2,14 L5,14 L7,4 L13,4 L15,14 L18,14',
  IRON_BUTTERFLY: 'M2,14 L5,14 L10,2 L15,14 L18,14',
  CALL_CALENDAR_SPREAD: 'M4,2 L4,14 M10,2 L10,14',
  PUT_CALENDAR_SPREAD: 'M4,2 L4,14 M10,2 L10,14',
  CALL_DIAGONAL: 'M3,2 L3,14 M11,4 L11,12',
  PUT_DIAGONAL: 'M3,2 L3,14 M11,4 L11,12',
  CALL_RATIO: 'M2,14 L8,14 L11,2 L14,14 L18,14',
  PUT_RATIO: 'M2,14 L8,14 L11,2 L14,14 L18,14',
  COMBO: 'M2,10 L8,2 L12,14 L18,6',
};

const messages = defineMessages(
  {
    call: 'Call',
    put: 'Put',
    straddle: 'Straddle',
    strangle: 'Strangle',
    callSpread: 'Call Spread',
    putSpread: 'Put Spread',
    butterfly: 'Butterfly',
    ironCondor: 'Iron Condor',
    ironFly: 'Iron Fly',
    calendar: 'Calendar',
    diagonal: 'Diagonal',
    ratio: 'Ratio',
    combo: 'Combo',
    custom: 'Custom',
    single: 'Single',
  },
  {
    call: 'Call',
    put: 'Put',
    straddle: 'Straddle',
    strangle: 'Strangle',
    callSpread: 'Call Spread',
    putSpread: 'Put Spread',
    butterfly: 'Butterfly',
    ironCondor: 'Iron Condor',
    ironFly: 'Iron Fly',
    calendar: 'Calendario',
    diagonal: 'Diagonal',
    ratio: 'Ratio',
    combo: 'Combo',
    custom: 'Personalizada',
    single: 'Simple',
  },
);

type StrategyLabelKey = keyof typeof messages.en;

const STRATEGY_LABELS: Record<string, StrategyLabelKey> = {
  CALL: 'call',
  PUT: 'put',
  STRADDLE: 'straddle',
  STRANGLE: 'strangle',
  CALL_SPREAD: 'callSpread',
  PUT_SPREAD: 'putSpread',
  CALL_BUTTERFLY: 'butterfly',
  PUT_BUTTERFLY: 'butterfly',
  CALL_BUTTERFLY_SPREAD: 'butterfly',
  PUT_BUTTERFLY_SPREAD: 'butterfly',
  IRON_CONDOR: 'ironCondor',
  IRON_BUTTERFLY: 'ironFly',
  CALL_CALENDAR_SPREAD: 'calendar',
  PUT_CALENDAR_SPREAD: 'calendar',
  CALL_DIAGONAL: 'diagonal',
  PUT_DIAGONAL: 'diagonal',
  CALL_RATIO: 'ratio',
  PUT_RATIO: 'ratio',
  COMBO: 'combo',
  CUSTOM: 'custom',
};

export function getStrategyLabel(
  strategy: string | null,
  legType: string | undefined,
  locale: Locale,
): string {
  if (!strategy) {
    const key = legType === 'CALL' ? 'call' : legType === 'PUT' ? 'put' : 'single';
    return translate(messages, key, undefined, locale);
  }
  const key = STRATEGY_LABELS[strategy];
  return key ? translate(messages, key, undefined, locale) : strategy;
}

export default function StrategyIcon({ strategy, size = 20 }: StrategyIconProps) {
  const locale = useLocale();
  const path = strategy ? STRATEGY_PATHS[strategy] : null;

  if (!path) {
    return (
      <span className={styles.fallback} style={{ width: size, height: size }}>
        ●
      </span>
    );
  }

  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 20 16"
      fill="none"
      aria-label={getStrategyLabel(strategy, undefined, locale)}
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
