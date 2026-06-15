export declare class TradingError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class NoLiquidityError extends TradingError {
    readonly legIndex: number;
    constructor(message: string, legIndex: number);
}
export declare class InvalidOrderError extends TradingError {
    constructor(message: string);
}
export declare class InsufficientCashError extends TradingError {
    readonly requiredUsd: number;
    readonly availableUsd: number;
    constructor(message: string, requiredUsd: number, availableUsd: number);
}
export declare class InsufficientMarginError extends TradingError {
    readonly requiredUsd: number;
    readonly availableUsd: number;
    readonly bufferUsd: number;
    constructor(message: string, requiredUsd: number, availableUsd: number, bufferUsd: number);
}
export declare class MarginCheckUnavailableError extends TradingError {
    readonly legIndex: number;
    readonly reason: string;
    constructor(message: string, legIndex: number, reason: string);
}
//# sourceMappingURL=errors.d.ts.map