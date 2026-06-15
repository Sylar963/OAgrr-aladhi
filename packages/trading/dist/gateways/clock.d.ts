export interface Clock {
    now(): Date;
}
export declare class SystemClock implements Clock {
    now(): Date;
}
export declare class FixedClock implements Clock {
    private readonly time;
    constructor(time: Date);
    now(): Date;
}
//# sourceMappingURL=clock.d.ts.map