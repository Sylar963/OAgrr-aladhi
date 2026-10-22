import { defineMessages } from '@lib/i18n';

export const positioningMessages = defineMessages(
  {
    noOpenInterest: 'No open interest.',
    noVenueData: 'No venue data.',
    oi: 'OI',
    share: 'Share',
    vol24h: '24h Vol',
    turnover: 'Turnover',

    kpiOpenInterest: 'Open Interest',
    kpiVolume24h: '24h Volume',
    kpiPcOi: 'P/C · OI',
    kpiPcVol: 'P/C · 24h Vol',
    kpiExpiring: 'Expiring ≤{n}d',
    noteUsdNotional: 'USD notional',
    notePcHeld: 'put $ / call $ held',
    notePcTraded: 'put $ / call $ traded',
    noteTurnover: '24h volume / OI',
    noteRollsOff: '{amount} rolls off',

    topTitle: 'Largest Positions',
    topSubtitle: 'Top contracts by OI, summed across venues · share of total OI',
    contract: 'Contract',
    vsSpot: 'vs Spot',
    mainVenue: 'Main venue',

    calendarTitle: 'Expiry Calendar',
    calendarSubtitle:
      'Where OI rolls off, where it may pin, and which expiries are active · USD notional',
    expiry: 'Expiry',
    pcUsd: 'P/C $',
    maxPain: 'Max Pain',
    vsFwd: 'vs Fwd',
    expMove: 'Exp. Move',
    calendarFootnote:
      'Max pain: settlement minimising holder payout, USD-weighted · Exp. move: ATM straddle cross-checked with ATM IV · Turnover: 24h volume / OI (high = active, low = stale) · Marked rows expire within {n}d',

    venueTitle: 'Venue Share & Pricing',
    venueSubtitle: 'Market share, activity, and ATM IV vs cross-venue median',
    venue: 'Venue',
    oiShare: 'OI Share',
    volShare: 'Vol Share',
    atmIvGap: 'ATM IV Gap',
    gapSamples: 'averaged over {n} expiries',
    venueFootnote:
      'ATM IV gap: venue mark IV interpolated at the forward minus the cross-venue median, averaged over expiries ≥{n}d · red = richer (sell there), green = cheaper (buy there)',
  },
  {
    noOpenInterest: 'Sin open interest.',
    noVenueData: 'Sin datos de exchanges.',
    oi: 'OI',
    share: 'Cuota',
    vol24h: 'Vol 24h',
    turnover: 'Rotación',

    kpiOpenInterest: 'Open Interest',
    kpiVolume24h: 'Volumen 24h',
    kpiPcOi: 'P/C · OI',
    kpiPcVol: 'P/C · Vol 24h',
    kpiExpiring: 'Vence ≤{n}d',
    noteUsdNotional: 'nocional USD',
    notePcHeld: 'put $ / call $ abiertos',
    notePcTraded: 'put $ / call $ negociados',
    noteTurnover: 'volumen 24h / OI',
    noteRollsOff: '{amount} vence',

    topTitle: 'Mayores posiciones',
    topSubtitle: 'Contratos top por OI, sumados entre exchanges · cuota del OI total',
    contract: 'Contrato',
    vsSpot: 'vs spot',
    mainVenue: 'Exchange principal',

    calendarTitle: 'Calendario de vencimientos',
    calendarSubtitle:
      'Dónde vence el OI, dónde podría anclar el precio y qué vencimientos están activos · nocional USD',
    expiry: 'Vencimiento',
    pcUsd: 'P/C $',
    maxPain: 'Max pain',
    vsFwd: 'vs fwd',
    expMove: 'Mov. esp.',
    calendarFootnote:
      'Max pain: liquidación que minimiza el pago a los tenedores, ponderada en USD · Mov. esp.: straddle ATM contrastado con la IV ATM · Rotación: volumen 24h / OI (alta = activo, baja = inactivo) · Las filas marcadas vencen en {n}d o menos',

    venueTitle: 'Cuota y precios por exchange',
    venueSubtitle: 'Cuota de mercado, actividad e IV ATM vs mediana entre exchanges',
    venue: 'Exchange',
    oiShare: 'Cuota OI',
    volShare: 'Cuota vol',
    atmIvGap: 'Brecha IV ATM',
    gapSamples: 'promediado en {n} vencimientos',
    venueFootnote:
      'Brecha IV ATM: IV mark del exchange interpolada en el forward menos la mediana entre exchanges, promediada en vencimientos ≥{n}d · rojo = más caro (vende ahí), verde = más barato (compra ahí)',
  },
);
