import { black76Price } from '@lib/analytics/blackScholes';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';
import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';
import type { ExecutionRoute } from './SignalCard';
import { LIVE_QUOTE_LIMITS, positive, type VerticalEconomics } from './vertical-pricing';

const DAY = 86_400_000;
export type PremiumTone = 'good' | 'bad' | 'watch' | 'unknown';
export type PremiumState = 'cheap' | 'fair' | 'rich' | 'unavailable';

export function premiumState(value: number | null, band = 0.02): PremiumState {
  return value == null || !Number.isFinite(value)
    ? 'unavailable'
    : value <= -band
      ? 'cheap'
      : value >= band
        ? 'rich'
        : 'fair';
}

export function premiumTone(state: PremiumState, selling: boolean): PremiumTone {
  if (state === 'unavailable') return 'unknown';
  if (state === 'fair') return 'watch';
  return (state === 'rich') === selling ? 'good' : 'bad';
}

export function premiumReference(context: AlphaMarketContextResponse | null) {
  const automatic = context?.automatic;
  const pricing = automatic?.pricing;
  const tenor = automatic && automatic.horizonDays <= 14 ? '7d' : '30d';
  const baseline = context?.richness?.tenors[tenor].premiumBaseline.medianSpread ?? null;
  const iv = pricing?.atmIv ?? null;
  const forecast = pricing?.forecastVol ?? null;
  const spread = iv != null && forecast != null ? iv - forecast : null;
  return {
    iv,
    forecast,
    spread,
    baseline,
    tenor,
    excess: spread != null && baseline != null ? spread - baseline : null,
    band: context?.richness?.fairBand ?? 0.02,
  };
}

function eligibleAsk(quote: VenueQuote | undefined, quantity: number, nowMs: number) {
  const e = quote?.execution;
  if (
    !quote ||
    !e ||
    e.inverse ||
    !e.settleCurrency ||
    !positive(e.askUsd) ||
    !positive(quote.asOfMs) ||
    quote.asOfMs > nowMs ||
    nowMs - quote.asOfMs > LIVE_QUOTE_LIMITS.maxQuoteAgeMs ||
    e.askTakerFeeUsd == null ||
    !Number.isFinite(e.askTakerFeeUsd) ||
    e.askTakerFeeUsd < 0 ||
    !positive(e.askSize) ||
    e.askSize < quantity ||
    !positive(e.minQuantity) ||
    quantity < e.minQuantity ||
    !positive(e.quantityStep) ||
    Math.abs(quantity / e.quantityStep - Math.round(quantity / e.quantityStep)) > 1e-7 ||
    (e.bidUsd != null && e.bidUsd > e.askUsd) ||
    (positive(e.minNotionalUsd) && (e.markUsd ?? e.askUsd) * quantity < e.minNotionalUsd - 1e-9)
  )
    return null;
  return e;
}

export function comparePremiums(
  candidate: VerticalEconomics | null,
  route: ExecutionRoute | null,
  chain: EnrichedChainResponse | undefined,
  context: AlphaMarketContextResponse | null,
  nowMs = Date.now(),
) {
  if (!candidate || !route || !chain) return { unavailable: 'select' } as const;
  if (route.buyVenue !== route.sellVenue) return { unavailable: 'crossVenue' } as const;
  const right = candidate.kind.startsWith('call') ? 'call' : 'put';
  const debit = candidate.kind.endsWith('debit');
  const buy = chain.strikes.find((r) => r.strike === candidate.buyStrike)?.[right].venues[
    route.buyVenue
  ];
  const sell = chain.strikes.find((r) => r.strike === candidate.sellStrike)?.[right].venues[
    route.sellVenue
  ];
  if (buy?.execution?.inverse || sell?.execution?.inverse || candidate.basePremium != null)
    return { unavailable: 'inverse' } as const;
  const q = candidate.quantity;
  const b = eligibleAsk(buy, q, nowMs);
  const s = sell?.execution;
  if (
    !positive(q) ||
    !b ||
    !s ||
    !positive(s.bidUsd) ||
    !positive(s.bidSize) ||
    s.bidSize < q ||
    !positive(sell?.asOfMs) ||
    sell.asOfMs > nowMs ||
    nowMs - sell.asOfMs > LIVE_QUOTE_LIMITS.maxQuoteAgeMs ||
    Math.abs(buy!.asOfMs! - sell.asOfMs) > LIVE_QUOTE_LIMITS.maxLegSkewMs ||
    s.bidTakerFeeUsd == null ||
    !Number.isFinite(s.bidTakerFeeUsd) ||
    s.bidTakerFeeUsd < 0 ||
    s.settleCurrency !== b.settleCurrency ||
    b.exchangeSymbol !== candidate.buySymbol ||
    s.exchangeSymbol !== candidate.sellSymbol ||
    candidate.expiry !== chain.expiry ||
    !positive(chain.expiryTs)
  )
    return { unavailable: 'quotes' } as const;
  const automatic = context?.automatic;
  const forecast = automatic?.pricing.forecastVol;
  const horizonEnd =
    context && automatic ? context.generatedAt + automatic.horizonDays * DAY : null;
  const T = (chain.expiryTs - nowMs) / (365.25 * DAY);
  if (
    !context ||
    context.underlying !== chain.underlying ||
    context.generatedAt > nowMs ||
    nowMs - context.generatedAt > 120_000 ||
    automatic?.horizonSource !== 'selected-expiry' ||
    horizonEnd == null ||
    Math.abs(horizonEnd - chain.expiryTs) > 1000 ||
    !positive(forecast) ||
    T <= 0 ||
    T > 90 / 365.25 ||
    !positive(buy?.underlyingPriceUsd) ||
    !positive(sell.underlyingPriceUsd)
  )
    return { unavailable: 'reference' } as const;
  const price = (quote: VenueQuote, strike: number) =>
    q * black76Price(right, quote.underlyingPriceUsd!, strike, T, forecast);
  const buyReference = price(buy!, candidate.buyStrike);
  const sellReference = price(sell, candidate.sellStrike);
  const spreadReference = debit ? buyReference - sellReference : sellReference - buyReference;
  const width = q * Math.abs(candidate.buyStrike - candidate.sellStrike);
  // Distinct venue forwards can break payoff bounds; do not clamp that into apparent value.
  if (
    ![buyReference, sellReference, spreadReference].every(Number.isFinite) ||
    spreadReference < 0 ||
    spreadReference > width
  )
    return { unavailable: 'reference' } as const;
  if (
    ![candidate.grossPremium, candidate.entryFee, candidate.costReserve].every(Number.isFinite) ||
    candidate.entryFee < 0 ||
    candidate.costReserve < 0
  )
    return { unavailable: 'quotes' } as const;
  const spreadCash = candidate.grossPremium - candidate.entryFee - candidate.costReserve;
  const spreadPrice = debit ? -spreadCash : spreadCash;
  if (spreadPrice <= 0 || spreadPrice >= width) return { unavailable: 'quotes' } as const;
  const spreadAdvantage = debit ? spreadReference - spreadPrice : spreadPrice - spreadReference;
  const buyCost = q * (b.askUsd! + b.askTakerFeeUsd!) + candidate.costReserve;
  const sellNet = q * (s.bidUsd - s.bidTakerFeeUsd);
  const alternativeRight: 'call' | 'put' = debit ? right : right === 'call' ? 'put' : 'call';
  const alternativeStrike = debit ? candidate.buyStrike : candidate.sellStrike;
  const alternativeQuote = chain.strikes.find((r) => r.strike === alternativeStrike)?.[
    alternativeRight
  ].venues[route.buyVenue];
  const a = eligibleAsk(alternativeQuote, q, nowMs);
  const alternative =
    a && a.settleCurrency === b.settleCurrency
      ? {
          right: alternativeRight,
          strike: alternativeStrike,
          cost: q * (a.askUsd! + a.askTakerFeeUsd!) + candidate.costReserve,
          reference: positive(alternativeQuote?.underlyingPriceUsd)
            ? q *
              black76Price(
                alternativeRight,
                alternativeQuote.underlyingPriceUsd,
                alternativeStrike,
                T,
                forecast,
              )
            : null,
        }
      : null;
  const savings = debit && alternative ? alternative.cost - spreadPrice : null;
  const reference = premiumReference(context);
  const buySaving = buyReference - buyCost;
  const sellRichness = sellNet - sellReference;
  const legAdvantage = debit ? buySaving : sellRichness;
  const stress = automatic.stress;
  const carryResolved =
    reference.excess != null &&
    reference.excess >= reference.band &&
    stress?.accelerationRatio != null &&
    stress.accelerationPercentile != null &&
    stress.backwardation === false &&
    !stress.accelerating;
  const pricingTone: PremiumTone =
    spreadAdvantage <= -0.01 ||
    legAdvantage <= -0.01 ||
    (!debit && reference.excess != null && reference.excess <= -reference.band)
      ? 'bad'
      : spreadAdvantage >= 0.01 && legAdvantage >= 0.01 && (debit || carryResolved)
        ? 'good'
        : 'watch';
  return {
    unavailable: null,
    debit,
    spreadPrice,
    spreadReference,
    spreadAdvantage,
    buyCost,
    buyReference,
    buySaving,
    sellNet,
    sellReference,
    sellRichness,
    pricingTone,
    alternative,
    savings,
    savingsPct: savings != null && alternative ? (savings / alternative.cost) * 100 : null,
    crossover:
      savings != null && savings > 0
        ? candidate.sellStrike + ((right === 'call' ? 1 : -1) * savings) / q
        : null,
    premiumShare: (spreadPrice / width) * 100,
    referenceVol: forecast,
  } as const;
}
