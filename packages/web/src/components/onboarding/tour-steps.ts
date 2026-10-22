import { defineMessages } from '@lib/i18n';

export const tourMessages = defineMessages(
  {
    viewsTitle: 'Views',
    viewsBody: 'Switch views — option chain, vol surface, GEX, flow, paper trading, portfolio.',
    assetTitle: 'Asset picker (⌘K)',
    assetBody: 'Pick your underlying. Hit ⌘K or / anytime to switch.',
    venueTitle: 'Venue status',
    venueBody:
      "Live venue count and feed latency. Click for per-venue status; if it degrades, a banner tells you what's happening.",
    accountTitle: 'Account',
    accountBody: 'Connect paper trading, track a live portfolio, and find help.',
    doneTitle: "That's the tour",
    doneBody: 'Reopen it anytime from the account menu. Press ? for shortcuts.',
    step: 'Step {n} of {total}',
    skip: 'Skip',
    back: 'Back',
    done: 'Done',
    next: 'Next',
  },
  {
    viewsTitle: 'Vistas',
    viewsBody:
      'Cambia de vista — cadena de opciones, superficie de vol, GEX, flujo, paper trading, portafolio.',
    assetTitle: 'Selector de activo (⌘K)',
    assetBody: 'Elige tu subyacente. Pulsa ⌘K o / en cualquier momento para cambiarlo.',
    venueTitle: 'Estado de exchanges',
    venueBody:
      'Cantidad de exchanges en vivo y latencia del feed. Haz clic para ver el estado por exchange; si se degrada, un aviso te dice qué está pasando.',
    accountTitle: 'Cuenta',
    accountBody: 'Conecta paper trading, sigue un portafolio en vivo y encuentra ayuda.',
    doneTitle: 'Fin del recorrido',
    doneBody: 'Vuelve a abrirlo cuando quieras desde el menú de cuenta. Pulsa ? para ver los atajos.',
    step: 'Paso {n} de {total}',
    skip: 'Omitir',
    back: 'Atrás',
    done: 'Listo',
    next: 'Siguiente',
  },
);

type TourKey = keyof typeof tourMessages.en;

export interface TourStep {
  /** Stable `[data-tour]` attribute on the element to spotlight; omitted for the centered wrap-up. */
  target?: string;
  title: TourKey;
  body: TourKey;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { target: 'views', title: 'viewsTitle', body: 'viewsBody' },
  { target: 'asset-picker', title: 'assetTitle', body: 'assetBody' },
  { target: 'venue-status', title: 'venueTitle', body: 'venueBody' },
  { target: 'account', title: 'accountTitle', body: 'accountBody' },
  { title: 'doneTitle', body: 'doneBody' },
];
