import type { AlphaLottoCandidate, AlphaStraddleCandidate } from '@oggregator/protocol';

import type { Leg } from '@features/architect/payoff';

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
