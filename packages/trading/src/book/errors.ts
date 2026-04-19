export class TradingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TradingError';
  }
}

export class NoLiquidityError extends TradingError {
  constructor(message: string, readonly legIndex: number) {
    super(message, 'NO_LIQUIDITY');
    this.name = 'NoLiquidityError';
  }
}

export class InvalidOrderError extends TradingError {
  constructor(message: string) {
    super(message, 'INVALID_ORDER');
    this.name = 'InvalidOrderError';
  }
}

export class InsufficientCashError extends TradingError {
  constructor(message: string, readonly requiredUsd: number, readonly availableUsd: number) {
    super(message, 'INSUFFICIENT_CASH');
    this.name = 'InsufficientCashError';
  }
}
