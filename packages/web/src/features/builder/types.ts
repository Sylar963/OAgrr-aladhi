export type OrderSide = 'buy' | 'sell';
export type OptionSide = 'call' | 'put';

export interface VenueExecution {
  venue: string;
  available: boolean;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  bidSize: number | null;
  askSize: number | null;
  iv: number | null;
  delta: number | null;
  contractSize: number;
  tickSize: number;
  minQty: number;
  bidMakerFeeUsd: number | null;
  bidTakerFeeUsd: number | null;
  askMakerFeeUsd: number | null;
  askTakerFeeUsd: number | null;
  settleCurrency: string;
  inverse: boolean;
  underlyingPrice: number;
}

export interface ExecutionCost {
  venue: string;
  entryPrice: number;
  premiumUsd: number;
  spreadCostUsd: number;
  feeUsd: number;
  totalCostUsd: number;
  sizeAvailable: number | null;
  fillable: boolean;
  slippageWarning: boolean;
}
