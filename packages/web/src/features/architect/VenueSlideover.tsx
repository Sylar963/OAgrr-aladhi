import {
  buildLegQuotes,
  computeStrategyRoundTrip,
  deriveAutoRouting,
  type LegInput,
  type PerLegBadge,
  type PerLegRoundTripQuote,
  type StrategyBadge,
  type StrategyRouting,
} from '@features/builder/round-trip';
import type { VenueExecution } from '@features/builder/types';
import { fmtUsd, formatExpiry } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';
import { VENUES } from '@lib/venue-meta';
import type { VenueId } from '@oggregator/protocol';
import type { EnrichedChainResponse } from '@shared/enriched';
import { useMemo, useState } from 'react';
import type { Leg } from './payoff';
import { detectStrategy } from './payoff';
import styles from './VenueSlideover.module.css';

interface VenueSlideoverProps {
  legs: Leg[];
  chain: EnrichedChainResponse | null;
  /** Per-tenor chain resolver — legs can live on different expiries. */
  chainFor?: (expiry: string) => EnrichedChainResponse | null;
  activeVenues: string[];
  onClose: () => void;
  onSendToPaper?: (routing: StrategyRouting) => void;
  isSending?: boolean;
}

export function buildVenueExecution(
  chain: EnrichedChainResponse,
  venueId: string,
  leg: Leg,
): VenueExecution | null {
  const strike = chain.strikes.find((s) => s.strike === leg.strike);
  if (!strike) return null;
  const side = leg.type === 'call' ? strike.call : strike.put;
  const q = side.venues[venueId as VenueId];
  const execution = q?.execution;
  if (!q || !execution) return null;
  return {
    venue: venueId,
    available:
      (execution.bidUsd != null && execution.bidUsd > 0) ||
      (execution.askUsd != null && execution.askUsd > 0),
    bidPrice: execution.bidUsd,
    askPrice: execution.askUsd,
    markPrice: execution.markUsd,
    bidSize: execution.bidSize,
    askSize: execution.askSize,
    iv: q.markIv,
    delta: q.delta,
    contractSize: 1,
    tickSize: execution.nativePriceTick,
    minQty: execution.minQuantity,
    quantityStep: execution.quantityStep,
    bidMakerFeeUsd: execution.bidMakerFeeUsd,
    bidTakerFeeUsd: execution.bidTakerFeeUsd,
    askMakerFeeUsd: execution.askMakerFeeUsd,
    askTakerFeeUsd: execution.askTakerFeeUsd,
    settleCurrency: execution.settleCurrency,
    inverse: execution.inverse,
    underlyingPrice: chain.stats.forwardPriceUsd ?? chain.stats.indexPriceUsd ?? 0,
  };
}

const messages = defineMessages(
  {
    badge_ok: 'OK',
    badge_elevated: 'ELEVATED',
    badge_high: 'HIGH',
    badge_excessive: 'EXCESSIVE',
    badge_unroutable: 'UNROUTABLE',
    title: 'Venue Comparison',
    legs_one: '{n} leg',
    legs_other: '{n} legs',
    netEntry: 'Net entry',
    roundTrip: 'Round-trip',
    na: 'N/A',
    entryOnly: 'ENTRY ONLY',
    worstLeg: 'Worst leg:',
    perBaseUnit: '{value}/base unit',
    unroutable:
      'One or more legs have no quote on the pinned venue. Pick another venue or check market data.',
    singleRouteRanking: 'Single-route ranking',
    rt: 'RT {value}',
    entryFees: 'entry {entry} · fees {fees}',
    notAvailable: 'Not available',
    selectedVenue: 'Selected single-route venue: {venue}',
    pinAll: 'Pin every leg to {venue}',
    perLegRouting: 'Per-leg routing',
    resetToAuto: 'Reset to auto',
    buy: 'BUY',
    sell: 'SELL',
    baseQty: '{n} base',
    venue: 'Venue',
    bid: 'Bid',
    bidSize: 'BidSize',
    ask: 'Ask',
    askSize: 'AskSize',
    rtHead: 'RT',
    noQuotes: 'No venue quotes for this leg',
    sending: 'Sending…',
    sendPinned: 'Send to paper (pinned routing)',
  },
  {
    badge_ok: 'OK',
    badge_elevated: 'ELEVADO',
    badge_high: 'ALTO',
    badge_excessive: 'EXCESIVO',
    badge_unroutable: 'SIN RUTA',
    title: 'Comparación de exchanges',
    legs_one: '{n} pata',
    legs_other: '{n} patas',
    netEntry: 'Entrada neta',
    roundTrip: 'Ida y vuelta',
    na: 'N/D',
    entryOnly: 'SOLO ENTRADA',
    worstLeg: 'Peor pata:',
    perBaseUnit: '{value}/unidad base',
    unroutable:
      'Una o más patas no tienen cotización en el exchange fijado. Elige otro exchange o revisa los datos de mercado.',
    singleRouteRanking: 'Ranking de ruta única',
    rt: 'RT {value}',
    entryFees: 'entrada {entry} · comisiones {fees}',
    notAvailable: 'No disponible',
    selectedVenue: 'Exchange de ruta única seleccionado: {venue}',
    pinAll: 'Fijar todas las patas a {venue}',
    perLegRouting: 'Ruteo por pata',
    resetToAuto: 'Volver a auto',
    buy: 'COMPRA',
    sell: 'VENTA',
    baseQty: '{n} base',
    venue: 'Exchange',
    bid: 'Bid',
    bidSize: 'Tam. bid',
    ask: 'Ask',
    askSize: 'Tam. ask',
    rtHead: 'RT',
    noQuotes: 'Sin cotizaciones de exchanges para esta pata',
    sending: 'Enviando…',
    sendPinned: 'Enviar a paper (ruteo fijado)',
  },
);

function fmtSize(v: number | null): string {
  if (v == null) return '?';
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export default function VenueSlideover({
  legs,
  chain,
  chainFor,
  activeVenues,
  onClose,
  onSendToPaper,
  isSending,
}: VenueSlideoverProps) {
  const t = useT(messages);
  const [expandedVenue, setExpandedVenue] = useState<string | null>(null);
  const [routing, setRouting] = useState<StrategyRouting>({ legs: {} });

  const legInputs = useMemo<LegInput[]>(() => {
    if (!chain) return [];
    return legs.map((leg) => {
      // Quotes must come from the leg's own tenor — looking the strike up on
      // the builder expiry's chain would price the wrong instrument (or drop
      // the leg) for cross-tenor strategies. Tenor chain not loaded yet → no
      // venues, which the routing badges surface as unroutable rather than
      // silently mispriced from the wrong expiry.
      const legChain = chainFor ? chainFor(leg.expiry) : chain;
      return {
        legId: leg.id,
        direction: leg.direction,
        quantity: leg.quantity * (leg.contractMultiplier ?? 1),
        venues: legChain
          ? activeVenues
              .map((venueId) => {
                const e = buildVenueExecution(legChain, venueId, leg);
                return e ? { venue: venueId, exec: e } : null;
              })
              .filter((v): v is { venue: string; exec: VenueExecution } => v != null)
          : [],
      };
    });
  }, [chain, chainFor, legs, activeVenues]);

  const effectiveRouting = useMemo(() => {
    const auto = deriveAutoRouting(legInputs);
    return { legs: { ...auto.legs, ...routing.legs } };
  }, [legInputs, routing]);

  const strategy = useMemo(
    () => (legInputs.length > 0 ? computeStrategyRoundTrip(legInputs, effectiveRouting) : null),
    [effectiveRouting, legInputs],
  );

  // Per-venue summary: cost if every leg routes through this venue
  const venueRanking = useMemo(() => {
    if (legInputs.length === 0) return [];
    return activeVenues.map((venueId) => {
      const allAvail = legInputs.every((leg) => leg.venues.some((v) => v.venue === venueId));
      const singleRoute: StrategyRouting = {
        legs: Object.fromEntries(
          legInputs.map((leg) => [
            leg.legId,
            {
              venue: venueId,
              pickedSide: leg.direction === 'buy' ? ('ask' as const) : ('bid' as const),
            },
          ]),
        ),
      };
      const r = computeStrategyRoundTrip(legInputs, singleRoute);
      return {
        venue: venueId,
        available: allAvail && r.routable,
        netEntryUsd: r.netEntryUsd,
        totalRoundTripUsd: r.totalRoundTripUsd,
        totalEntryFeesUsd: r.totalEntryFeesUsd,
        totalExitFeesUsd: r.totalExitFeesUsd,
        classification: r.strategyClassification,
        roundTripComplete: r.roundTripComplete,
      };
    });
  }, [activeVenues, legInputs]);

  const sortedVenues = useMemo(() => {
    return [...venueRanking].sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (a.roundTripComplete !== b.roundTripComplete) return a.roundTripComplete ? -1 : 1;
      return a.totalRoundTripUsd - b.totalRoundTripUsd;
    });
  }, [venueRanking]);

  const expandedVenueSummary = useMemo(
    () => sortedVenues.find((venue) => venue.venue === expandedVenue) ?? null,
    [expandedVenue, sortedVenues],
  );

  function pinLeg(legId: string, venue: string, side: 'bid' | 'ask') {
    setRouting((prev) => ({
      legs: { ...prev.legs, [legId]: { venue, pickedSide: side } },
    }));
  }

  function pinAllToVenue(venue: string) {
    setRouting(() => {
      const out: StrategyRouting = { legs: {} };
      for (const leg of legInputs) {
        if (leg.venues.some((v) => v.venue === venue)) {
          out.legs[leg.legId] = {
            venue,
            pickedSide: leg.direction === 'buy' ? 'ask' : 'bid',
          };
        }
      }
      return out;
    });
  }

  function resetToAuto() {
    setRouting({ legs: {} });
  }

  function handleSendToPaper() {
    if (!onSendToPaper || !strategy?.routable) return;
    const explicitRouting: StrategyRouting = { legs: {} };
    for (const [legId, pin] of Object.entries(routing.legs)) {
      const input = legInputs.find((leg) => leg.legId === legId);
      if (input?.venues.some((venue) => venue.venue === pin.venue)) {
        explicitRouting.legs[legId] = pin;
      }
    }
    onSendToPaper(explicitRouting);
  }

  if (!chain || legs.length === 0) return null;

  const strategyName = detectStrategy(legs);
  const strategyExpiry = legs[0]?.expiry ?? '';

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>{t('title')}</span>
          <span className={styles.headerMeta}>
            {strategyName} · {t(legs.length !== 1 ? 'legs_other' : 'legs_one', { n: legs.length })}
            {strategyExpiry ? ` · ${formatExpiry(strategyExpiry)}` : ''}
          </span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          ✕
        </button>
      </div>

      {strategy && (
        <div className={styles.summary} data-class={strategy.strategyClassification}>
          <div className={styles.summaryTopRow}>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>{t('netEntry')}</span>
              <span
                className={styles.summaryVal}
                data-positive={strategy.netEntryUsd > 0 || undefined}
                data-negative={strategy.netEntryUsd < 0 || undefined}
              >
                {strategy.netEntryUsd > 0 ? '+' : ''}
                {fmtUsd(strategy.netEntryUsd)}
              </span>
            </div>
            <div className={styles.summaryCol}>
              <span className={styles.summaryLabel}>{t('roundTrip')}</span>
              <span className={styles.summaryVal} data-rt-class={strategy.strategyClassification}>
                {strategy.roundTripComplete ? fmtUsd(strategy.totalRoundTripUsd) : t('na')}
              </span>
            </div>
            <span className={styles.viabilityBadge} data-class={strategy.strategyClassification}>
              {strategy.roundTripComplete
                ? t(`badge_${strategy.strategyClassification}`)
                : t('entryOnly')}
            </span>
          </div>
          {strategy.worstLeg?.classification && legs.length > 1 && (
            <div className={styles.worstLegRow}>
              {t('worstLeg')}{' '}
              <span className={styles.worstLegMeta}>
                {(() => {
                  const wl = legs.find((l) => l.id === strategy.worstLeg!.legId);
                  if (!wl) return strategy.worstLeg.legId;
                  return `${wl.direction === 'buy' ? 'B' : 'S'} ${wl.strike.toLocaleString()} ${wl.type === 'call' ? 'C' : 'P'} / ${VENUES[strategy.worstLeg.venue]?.label ?? strategy.worstLeg.venue}`;
                })()}
              </span>{' '}
              = {t('perBaseUnit', { value: fmtUsd(strategy.worstLeg.roundTripPerBase ?? 0) })}{' '}
              <span data-class={strategy.worstLeg.classification} className={styles.worstLegBadge}>
                {t(`badge_${strategy.worstLeg.classification}`)}
              </span>
            </div>
          )}
          {!strategy.routable && (
            <div className={styles.unroutableNote}>
              {t('unroutable')}
            </div>
          )}
        </div>
      )}

      <div className={styles.list}>
        <div className={styles.sectionHeader}>{t('singleRouteRanking')}</div>
        {sortedVenues.map((vc, i) => {
          const meta = VENUES[vc.venue];
          const isExpanded = expandedVenue === vc.venue;
          const isBest = i === 0 && vc.available;

          return (
            <div
              key={vc.venue}
              className={styles.venueRow}
              data-best={isBest || undefined}
              data-open={isExpanded || undefined}
              data-unavailable={!vc.available || undefined}
            >
              <button
                className={styles.venueMain}
                onClick={() => setExpandedVenue(isExpanded ? null : vc.venue)}
              >
                <div className={styles.rank} data-best={isBest || undefined}>
                  {vc.available ? `#${i + 1}` : '–'}
                </div>

                <div className={styles.venueId}>
                  {meta?.logo && <img src={meta.logo} alt="" className={styles.venueLogo} />}
                  <span className={styles.venueName}>{meta?.label ?? vc.venue}</span>
                </div>

                <div className={styles.venueNumbers}>
                  {vc.available ? (
                    <>
                      <span className={styles.venueRt} data-class={vc.classification}>
                        {t('rt', {
                          value: vc.roundTripComplete ? fmtUsd(vc.totalRoundTripUsd) : t('na'),
                        })}
                      </span>
                      <span className={styles.venueSub}>
                        {t('entryFees', {
                          entry: fmtUsd(vc.netEntryUsd),
                          fees: fmtUsd(vc.totalEntryFeesUsd + vc.totalExitFeesUsd),
                        })}
                      </span>
                    </>
                  ) : (
                    <span className={styles.venueUnavail}>{t('notAvailable')}</span>
                  )}
                </div>

                <span className={styles.chevron} data-open={isExpanded || undefined}>
                  ▾
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {expandedVenueSummary?.available && (
        <div className={styles.listAction}>
          <span className={styles.listActionLabel}>
            {t('selectedVenue', {
              venue: VENUES[expandedVenueSummary.venue]?.label ?? expandedVenueSummary.venue,
            })}
          </span>
          <button
            className={styles.useAllBtn}
            onClick={() => pinAllToVenue(expandedVenueSummary.venue)}
          >
            {t('pinAll', {
              venue: VENUES[expandedVenueSummary.venue]?.label ?? expandedVenueSummary.venue,
            })}
          </button>
        </div>
      )}

      <div className={styles.legsSection}>
        <div className={styles.legsSectionHead}>
          <span className={styles.sectionHeader}>{t('perLegRouting')}</span>
          <button className={styles.resetBtn} onClick={resetToAuto}>
            {t('resetToAuto')}
          </button>
        </div>
        {legs.map((leg) => {
          const legIn = legInputs.find((l) => l.legId === leg.id);
          if (!legIn) return null;
          const quotes = buildLegQuotes(legIn);
          const pin = effectiveRouting.legs[leg.id];
          const crossedSide: 'bid' | 'ask' = leg.direction === 'buy' ? 'ask' : 'bid';

          return (
            <div key={leg.id} className={styles.legBlock}>
              <div className={styles.legBlockHead}>
                <span data-direction={leg.direction} className={styles.legBlockDir}>
                  {leg.direction === 'buy' ? t('buy') : t('sell')}
                </span>
                <span className={styles.legBlockQty}>
                  {t('baseQty', { n: leg.quantity * (leg.contractMultiplier ?? 1) })}
                </span>
                <span className={styles.legBlockStrike}>{leg.strike.toLocaleString()}</span>
                <span data-type={leg.type} className={styles.legBlockType}>
                  {leg.type === 'call' ? 'C' : 'P'}
                </span>
                <span className={styles.legBlockExpiry}>{formatExpiry(leg.expiry)}</span>
              </div>

              <div className={styles.legTable}>
                <div className={styles.legTableHead}>
                  <span>{t('venue')}</span>
                  <span data-side="bid" data-active={crossedSide === 'bid' || undefined}>
                    {t('bid')}
                  </span>
                  <span>{t('bidSize')}</span>
                  <span data-side="ask" data-active={crossedSide === 'ask' || undefined}>
                    {t('ask')}
                  </span>
                  <span>{t('askSize')}</span>
                  <span>{t('rtHead')}</span>
                </div>
                {quotes.map((q) => {
                  const meta = VENUES[q.venue];
                  const pinned = pin?.venue === q.venue;
                  const unavailable = q.entryPrice == null || q.entryFeeUsd == null;
                  return (
                    <button
                      key={q.venue}
                      className={styles.legTableRow}
                      data-pinned={pinned || undefined}
                      data-unavailable={unavailable || undefined}
                      data-class={q.classification ?? undefined}
                      disabled={unavailable}
                      onClick={() => pinLeg(leg.id, q.venue, crossedSide)}
                    >
                      <span className={styles.legCellVenue}>
                        {meta?.logo && (
                          <img src={meta.logo} alt="" className={styles.legCellLogo} />
                        )}
                        {meta?.label ?? q.venue}
                        {pinned && <span className={styles.pinDot}>●</span>}
                      </span>
                      <span
                        className={styles.legCellPrice}
                        data-active={crossedSide === 'bid' || undefined}
                      >
                        {q.bidPrice != null ? fmtUsd(q.bidPrice) : '—'}
                      </span>
                      <span className={styles.legCellSize}>{fmtSize(q.bidSize)}</span>
                      <span
                        className={styles.legCellPrice}
                        data-active={crossedSide === 'ask' || undefined}
                      >
                        {q.askPrice != null ? fmtUsd(q.askPrice) : '—'}
                      </span>
                      <span className={styles.legCellSize}>
                        {fmtSize(q.askSize)}
                        {q.slippageWarning && <span className={styles.slipFlag}>⚠</span>}
                      </span>
                      <span className={styles.legCellRt} data-class={q.classification ?? undefined}>
                        {q.roundTripUsd != null ? fmtUsd(q.roundTripUsd) : '—'}
                      </span>
                    </button>
                  );
                })}
                {quotes.length === 0 && (
                  <div className={styles.legTableEmpty}>{t('noQuotes')}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {onSendToPaper && (
        <div className={styles.footer}>
          <button
            className={styles.sendBtn}
            disabled={!strategy?.routable || isSending}
            onClick={handleSendToPaper}
          >
            {isSending ? t('sending') : t('sendPinned')}
          </button>
        </div>
      )}
    </div>
  );
}

export type { PerLegBadge, PerLegRoundTripQuote, StrategyBadge };
