import { z } from 'zod';
export const LeadCaptureRequestSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(320),
    source: z.string().trim().min(1).max(64),
});
//# sourceMappingURL=leads.js.map