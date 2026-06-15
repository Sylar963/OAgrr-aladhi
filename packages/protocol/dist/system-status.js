import { z } from 'zod';
// ── Severity ──────────────────────────────────────────────────────
export const SystemAnnouncementSeveritySchema = z.enum(['info', 'notice', 'degraded', 'outage']);
// ── Announcement ──────────────────────────────────────────────────
/** Operator-authored status flag served by GET /api/health. */
export const SystemAnnouncementSchema = z.object({
    id: z.string().min(1),
    severity: SystemAnnouncementSeveritySchema,
    blocking: z.boolean().default(false),
    title: z.string().min(1),
    message: z.string().optional(),
    startsAt: z.number().int().positive().optional(),
    endsAt: z.number().int().positive().optional(),
    dismissible: z.boolean().optional(),
});
//# sourceMappingURL=system-status.js.map