import { z } from 'zod';
export declare const LeadCaptureRequestSchema: z.ZodObject<{
    email: z.ZodString;
    source: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    source: string;
}, {
    email: string;
    source: string;
}>;
export type LeadCaptureRequest = z.infer<typeof LeadCaptureRequestSchema>;
//# sourceMappingURL=leads.d.ts.map