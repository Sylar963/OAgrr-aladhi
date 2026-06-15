export class TradingError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'TradingError';
    }
}
export class NoLiquidityError extends TradingError {
    legIndex;
    constructor(message, legIndex) {
        super(message, 'NO_LIQUIDITY');
        this.legIndex = legIndex;
        this.name = 'NoLiquidityError';
    }
}
export class InvalidOrderError extends TradingError {
    constructor(message) {
        super(message, 'INVALID_ORDER');
        this.name = 'InvalidOrderError';
    }
}
export class InsufficientCashError extends TradingError {
    requiredUsd;
    availableUsd;
    constructor(message, requiredUsd, availableUsd) {
        super(message, 'INSUFFICIENT_CASH');
        this.requiredUsd = requiredUsd;
        this.availableUsd = availableUsd;
        this.name = 'InsufficientCashError';
    }
}
//# sourceMappingURL=errors.js.map