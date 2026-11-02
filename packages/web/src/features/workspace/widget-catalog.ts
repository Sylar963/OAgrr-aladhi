import { defineMessages, useT } from '@lib/i18n';
import { CARD_KINDS, type CardKind, useTabs, type WidgetKind } from '@lib/tabs';
import { useMemo } from 'react';

const cardMessages = defineMessages(
  {
    'oi-summary': 'OI summary',
    'venue-share': 'Venue share',
    'top-positions': 'Top positions',
    'expiry-calendar': 'Expiry calendar',
    'vol-curves': 'Vol curves',
    'break-even': 'Break-even forecast',
    'time-at-price': 'Time at price',
    'oi-by-strike': 'OI by strike',
    'dvol-chart': 'DVOL chart',
    'dvol-heatmap': 'DVOL heatmap',
    'vol-smile': 'Vol smile',
    'atm-term': 'ATM term structure',
    'realized-vs-implied': 'Realized vs implied',
    'surface-3d': '3D vol surface',
    'iv-rank': 'IV rank',
    'skew-history': 'Skew history',
  } satisfies Record<CardKind, string>,
  {
    'oi-summary': 'Resumen de OI',
    'venue-share': 'Cuota por exchange',
    'top-positions': 'Mayores posiciones',
    'expiry-calendar': 'Calendario de vencimientos',
    'vol-curves': 'Curvas de volatilidad',
    'break-even': 'Pronóstico de equilibrio',
    'time-at-price': 'Tiempo en precio',
    'oi-by-strike': 'OI por strike',
    'dvol-chart': 'Gráfico DVOL',
    'dvol-heatmap': 'Mapa de calor DVOL',
    'vol-smile': 'Sonrisa de volatilidad',
    'atm-term': 'Estructura temporal ATM',
    'realized-vs-implied': 'Realizada vs implícita',
    'surface-3d': 'Superficie de volatilidad 3D',
    'iv-rank': 'Rango de IV',
    'skew-history': 'Historial de skew',
  },
);

export interface WidgetCatalogEntry {
  kind: WidgetKind;
  label: string;
}

/** Every widget a custom tab can hold, with labels in the active language. */
export function useWidgetCatalog(): readonly WidgetCatalogEntry[] {
  const tabs = useTabs();
  const t = useT(cardMessages);
  return useMemo(
    () => [
      ...tabs.map((tab) => ({ kind: tab.id, label: tab.label })),
      ...CARD_KINDS.map((kind) => ({ kind, label: t(kind) })),
    ],
    [tabs, t],
  );
}
