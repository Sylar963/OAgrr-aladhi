import type { Locale } from '@lib/i18n';

export interface Sponsor {
  id: string;
  category: string;
  sponsor: string;
  labels: string[];
  href: string;
}

export const SPONSORS: Sponsor[] = [
  {
    id: 'coincall',
    category: 'SPONSORED',
    sponsor: 'Coincall',
    labels: [
      'Trade options with up to $30K bonus',
      'Low fees + deep options liquidity',
      'Join Coincall — $30K welcome bonus',
    ],
    href: 'https://www.coincall.com/r/43394533',
  },
  {
    id: 'thalex',
    category: 'SPONSORED',
    sponsor: 'Thalex',
    labels: [
      'Get funded — apply to the Thalex Funding Program',
      'Trade options with Thalex funded capital',
      'Prove your edge — Thalex Funding Program',
    ],
    href: 'https://thalex.com/exchange/sign-up?referral=OWNBZS',
  },
  {
    id: 'bybit',
    category: 'SPONSORED',
    sponsor: 'Bybit',
    labels: [
      'Scalp Bybit perps — sub-ms matching, deepest books',
      'Bybit — built for scalpers, tight spreads, instant fills',
      'Trade fast on Bybit — the scalper-friendly venue',
    ],
    href: 'https://partner.bybit.com/b/146658',
  },
  {
    id: 'derive',
    category: 'SPONSORED',
    sponsor: 'Derive',
    labels: [
      'Derive — best IV pricing for HYPE & BTC, permissionless',
      'Trade HYPE & BTC on Derive — deepest on-chain liquidity',
      'Derive — permissionless options, tightest IV on HYPE & BTC',
    ],
    href: 'https://app.derive.xyz?ref=oggregator',
  },
];

export const AD_EVERY = 6;

const SPANISH_LABELS: Record<string, string[]> = {
  coincall: [
    'Opera opciones con hasta $30K de bono',
    'Comisiones bajas + liquidez profunda en opciones',
    'Únete a Coincall — $30K de bono de bienvenida',
  ],
  thalex: [
    'Obtén capital — aplica al Thalex Funding Program',
    'Opera opciones con capital fondeado por Thalex',
    'Demuestra tu ventaja — Thalex Funding Program',
  ],
  bybit: [
    'Scalping de perps en Bybit — matching sub-ms, books más profundos',
    'Bybit — hecho para scalpers, spreads ajustados, ejecuciones instantáneas',
    'Opera rápido en Bybit — el exchange ideal para scalpers',
  ],
  derive: [
    'Derive — el mejor precio de IV para HYPE y BTC, sin permisos',
    'Opera HYPE y BTC en Derive — la liquidez on-chain más profunda',
    'Derive — opciones sin permisos, la IV más ajustada en HYPE y BTC',
  ],
};

const SPONSORS_ES: Sponsor[] = SPONSORS.map((s) => ({
  ...s,
  category: s.category === 'SPONSORED' ? 'PATROCINADO' : s.category,
  labels: SPANISH_LABELS[s.id] ?? s.labels,
}));

export function sponsorsFor(locale: Locale): Sponsor[] {
  return locale === 'es' ? SPONSORS_ES : SPONSORS;
}
