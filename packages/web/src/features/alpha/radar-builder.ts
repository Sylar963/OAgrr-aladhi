import type { AlphaLottoCandidate } from '@oggregator/protocol';

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
