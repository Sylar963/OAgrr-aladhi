import type {
  AlphaLongStraddleCandidate,
  AlphaLottoCandidate,
  AlphaStraddleCandidate,
} from '@oggregator/protocol';

import type { Leg } from '@features/architect/payoff';
import type { EnrichedChainResponse, VenueId } from '@shared/enriched';
import type { VerticalEconomics } from './vertical-pricing';

type RadarBuilderCandidate = Pick<
  AlphaLottoCandidate,
  | 'venue'
  | 'underlying'
  | 'instrument'
  | 'expiry'
  | 'strike'
  | 'contractSize'
  | 'minQty'
  | 'ask'
  | 'delta'
  | 'markIv'
>;

export function candidateToBuilderLeg(candidate: RadarBuilderCandidate): Leg {
  return {
    id: `radar:${candidate.venue}:${candidate.instrument}`,
    type: 'call',
    direction: 'buy',
    strike: candidate.strike,
    expiry: candidate.expiry,
    quantity: Number((candidate.minQty * candidate.contractSize).toFixed(8)),
    entryPrice: candidate.ask / candidate.contractSize,
    venue: candidate.venue,
    delta: candidate.delta,
    gamma: null,
    theta: null,
    vega: null,
    iv: candidate.markIv,
  };
}

type StraddleBuilderCandidate = Pick<
  AlphaStraddleCandidate,
  | 'venue'
  | 'expiry'
  | 'strike'
  | 'callInstrument'
  | 'putInstrument'
  | 'callBid'
  | 'putBid'
  | 'markIv'
  | 'suggestedQuantity'
  | 'minQuantity'
>;

export function straddleToBuilderLegs(candidate: StraddleBuilderCandidate): Leg[] {
  const quantity = candidate.suggestedQuantity > 0 ? candidate.suggestedQuantity : candidate.minQuantity;
  const leg = (type: 'call' | 'put', instrument: string, bid: number): Leg => ({
    id: `straddle:${candidate.venue}:${instrument}`,
    type,
    direction: 'sell',
    strike: candidate.strike,
    expiry: candidate.expiry,
    quantity,
    entryPrice: bid,
    venue: candidate.venue,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: candidate.markIv,
  });
  return [
    leg('call', candidate.callInstrument, candidate.callBid),
    leg('put', candidate.putInstrument, candidate.putBid),
  ];
}

type LongStraddleBuilderCandidate = Pick<
  AlphaLongStraddleCandidate,
  | 'venue'
  | 'expiry'
  | 'strike'
  | 'callInstrument'
  | 'putInstrument'
  | 'callAsk'
  | 'putAsk'
  | 'markIv'
  | 'suggestedQuantity'
  | 'minQuantity'
>;

export function longStraddleToBuilderLegs(candidate: LongStraddleBuilderCandidate): Leg[] {
  const quantity = candidate.suggestedQuantity > 0 ? candidate.suggestedQuantity : candidate.minQuantity;
  const leg = (type: 'call' | 'put', instrument: string, ask: number): Leg => ({
    id: `long-straddle:${candidate.venue}:${instrument}`,
    type,
    direction: 'buy',
    strike: candidate.strike,
    expiry: candidate.expiry,
    quantity,
    entryPrice: ask,
    venue: candidate.venue,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: candidate.markIv,
  });
  return [
    leg('call', candidate.callInstrument, candidate.callAsk),
    leg('put', candidate.putInstrument, candidate.putAsk),
  ];
}

type PutBuilderCandidate = RadarBuilderCandidate & { hedge: { coveredQty: number } | null };

export function putCandidateToBuilderLeg(candidate: PutBuilderCandidate): Leg {
  const quantity =
    candidate.hedge != null && candidate.hedge.coveredQty > 0
      ? candidate.hedge.coveredQty
      : candidate.minQty * candidate.contractSize;
  return {
    id: `put-radar:${candidate.venue}:${candidate.instrument}`,
    type: 'put',
    direction: 'buy',
    strike: candidate.strike,
    expiry: candidate.expiry,
    quantity: Number(quantity.toFixed(8)),
    entryPrice: candidate.ask / candidate.contractSize,
    venue: candidate.venue,
    delta: candidate.delta,
    gamma: null,
    theta: null,
    vega: null,
    iv: candidate.markIv,
  };
}

/**
 * Builder legs for a priced vertical, at the quotes it was priced on. `perContract` converts
 * the base-unit quantity into contracts for markets whose Builder sizes legs in contracts.
 */
export function verticalToBuilderLegs(
  candidate: VerticalEconomics,
  route: { sellVenue: string; buyVenue: string },
  chain: EnrichedChainResponse,
  perContract: boolean,
): Leg[] | null {
  const right = candidate.kind.startsWith('call') ? 'call' : 'put';
  const leg = (direction: 'buy' | 'sell', strike: number, venue: string): Leg | null => {
    const quote = chain.strikes.find((s) => s.strike === strike)?.[right].venues[venue as VenueId];
    const execution = quote?.execution;
    const price = direction === 'buy' ? execution?.askUsd : execution?.bidUsd;
    if (!quote || !execution || price == null) return null;
    return {
      id: `vertical:${venue}:${candidate.expiry}:${right}:${direction}:${strike}`,
      type: right,
      direction,
      strike,
      expiry: candidate.expiry,
      quantity: perContract
        ? candidate.quantity / execution.contractMultiplierBase
        : candidate.quantity,
      entryPrice: price,
      venue,
      delta: quote.delta,
      gamma: quote.gamma,
      theta: quote.theta,
      vega: quote.vega,
      iv: quote.markIv,
    };
  };
  const sell = leg('sell', candidate.sellStrike, route.sellVenue);
  const buy = leg('buy', candidate.buyStrike, route.buyVenue);
  return sell && buy ? [sell, buy] : null;
}
