import { z } from 'zod';
export declare const FundedRouteTypeSchema: z.ZodEnum<["test", "instant"]>;
export declare const FundedSettlementCadenceSchema: z.ZodEnum<["daily", "weekly"]>;
export declare const FundedRunStatusSchema: z.ZodEnum<["test_active", "test_passed", "test_failed", "funded_active", "breached", "withdrawn"]>;
export declare const StartFundedRunRequestSchema: z.ZodObject<{
    templateId: z.ZodString;
    depositUsd: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    templateId: string;
    depositUsd?: number | undefined;
}, {
    templateId: string;
    depositUsd?: number | undefined;
}>;
export type StartFundedRunRequest = z.infer<typeof StartFundedRunRequestSchema>;
export type FundedRouteType = z.infer<typeof FundedRouteTypeSchema>;
export type FundedSettlementCadence = z.infer<typeof FundedSettlementCadenceSchema>;
export type FundedRunStatus = z.infer<typeof FundedRunStatusSchema>;
export interface FundedTemplateDto {
    id: string;
    name: string;
    routeType: FundedRouteType;
    testDepositMinUsd: number | null;
    testProfitTargetPct: number | null;
    testMaxDrawdownPct: number | null;
    fundedAbc: number;
    abcFloorPct: number;
    profitSplitPct: number;
    settlementCadence: FundedSettlementCadence;
    maxRunsPerUser: number;
}
export interface FundedSettlementDto {
    settledAt: string;
    equityUsd: number;
    abcCredited: number;
    cumulativeProfitUsd: number;
    traderShareUsd: number;
    drawdownPct: number;
    floorBreached: boolean;
}
export interface FundedRunEventDto {
    kind: string;
    summary: string;
    ts: string;
}
export interface FundedRunSummaryDto {
    id: string;
    templateId: string;
    routeType: FundedRouteType;
    status: FundedRunStatus;
    depositUsd: number | null;
    abcCredited: number;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
}
export interface FundedRunDetailDto extends FundedRunSummaryDto {
    paperAccountId: string;
    equityUsd: number | null;
    settlements: FundedSettlementDto[];
    events: FundedRunEventDto[];
}
//# sourceMappingURL=funded.d.ts.map