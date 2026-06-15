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
//# sourceMappingURL=errors.d.ts.map