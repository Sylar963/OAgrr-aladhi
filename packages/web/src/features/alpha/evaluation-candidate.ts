import type {
  AlphaEvaluationCandidate,
  AlphaEvaluationLeg,
  AlphaLottoCandidate,
  AlphaPutCandidate,
  EnrichedChainResponse,
  VenueId,
} from '@oggregator/protocol';
import type { ExecutionRoute } from './SignalCard';
import type { VerticalEconomics } from './vertical-pricing';

function quoteMode(venue: string): AlphaEvaluationLeg['quoteMode'] {
  return venue === 'tastytrade' ? 'delayed' : 'live';
}

export function verticalEvaluationCandidate(
  candidate: VerticalEconomics,
  chain: EnrichedChainResponse,
  route: ExecutionRoute,
  lossBudget: number | null,
): AlphaEvaluationCandidate | null {
  const right = candidate.kind.startsWith('call') ? 'call' : 'put';
  const leg = (side: 'buy' | 'sell', strike: number, venue: VenueId): AlphaEvaluationLeg | null => {
    const quote = chain.strikes.find((row) => row.strike === strike)?.[right]?.venues[venue];
    const execution = quote?.execution;
    const price = side === 'buy' ? execution?.askUsd : execution?.bidUsd;
    if (!quote || !execution || price == null || price <= 0 || !execution.settleCurrency)
      return null;
    return {
      venue,
      instrument: execution.exchangeSymbol,
      right,
      side,
      strike,
      quantity: candidate.quantity,
      price,
      fee: side === 'buy' ? execution.askTakerFeeUsd : execution.bidTakerFeeUsd,
      availableQuantity: side === 'buy' ? execution.askSize : execution.bidSize,
      minQuantity: execution.minQuantity,
      quantityStep: execution.quantityStep,
      quotedAt: quote.asOfMs ?? null,
      quoteMode: quoteMode(venue),
      markIv: quote.markIv,
      inverse: execution.inverse,
      settlement: execution.settleCurrency,
    };
  };
  const buy = leg('buy', candidate.buyStrike, route.buyVenue);
  const sell = leg('sell', candidate.sellStrike, route.sellVenue);
  const spot = chain.stats.indexPriceUsd;
  if (!buy || !sell || chain.expiryTs == null || spot == null || spot <= 0) return null;
  return {
    strategy: candidate.kind,
    underlying: chain.underlying,
    expiryTs: chain.expiryTs,
    spot,
    atmIv: chain.stats.atmIv,
    legs: [buy, sell],
    holdingQuantity: 0,
    entryFee: candidate.entryFee,
    costReserve: candidate.costReserve,
    lossBudget:
      lossBudget != null && Number.isFinite(lossBudget) && lossBudget > 0 ? lossBudget : null,
  };
}

export function longOptionEvaluationCandidate(
  candidate: AlphaLottoCandidate | AlphaPutCandidate,
  contracts: number,
  holdingQuantity = 0,
): AlphaEvaluationCandidate {
  const right = 'protection' in candidate ? 'put' : 'call';
  const scale = candidate.contractSize;
  const quantity = contracts * scale;
  return {
    strategy: holdingQuantity > 0 ? 'protective-put' : right === 'call' ? 'long-call' : 'long-put',
    underlying: candidate.underlying,
    expiryTs: candidate.expiryTs,
    spot: candidate.indexPrice,
    atmIv: candidate.atmIv,
    holdingQuantity,
    entryFee: candidate.takerFee == null ? null : candidate.takerFee * contracts,
    costReserve: null,
    lossBudget: null,
    legs: [
      {
        venue: candidate.venue,
        instrument: candidate.instrument,
        right,
        side: 'buy',
        strike: candidate.strike,
        quantity,
        price: candidate.ask / scale,
        fee: candidate.takerFee == null ? null : candidate.takerFee / scale,
        availableQuantity: candidate.askSize == null ? null : candidate.askSize * scale,
        minQuantity: candidate.minQty * scale,
        quantityStep: null,
        quotedAt: candidate.asOfMs,
        quoteMode: quoteMode(candidate.venue),
        markIv: candidate.markIv,
        inverse: candidate.inverse,
        settlement: candidate.settle,
      },
    ],
  };
}
