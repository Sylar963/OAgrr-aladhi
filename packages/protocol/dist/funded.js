import { z } from 'zod';
export const FundedRouteTypeSchema = z.enum(['test', 'instant']);
export const FundedSettlementCadenceSchema = z.enum(['daily', 'weekly']);
export const FundedRunStatusSchema = z.enum([
    'test_active',
    'test_passed',
    'test_failed',
    'funded_active',
    'breached',
    'withdrawn',
]);
export const StartFundedRunRequestSchema = z.object({
    templateId: z.string().min(1).max(120),
    depositUsd: z.number().positive().max(10_000_000).optional(),
});
//# sourceMappingURL=funded.js.map