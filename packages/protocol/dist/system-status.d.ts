import { z } from 'zod';
export declare const SystemAnnouncementSeveritySchema: z.ZodEnum<["info", "notice", "degraded", "outage"]>;
export type SystemAnnouncementSeverity = z.infer<typeof SystemAnnouncementSeveritySchema>;
/** Operator-authored status flag served by GET /api/health. */
export declare const SystemAnnouncementSchema: z.ZodObject<{
    id: z.ZodString;
    severity: z.ZodEnum<["info", "notice", "degraded", "outage"]>;
    blocking: z.ZodDefault<z.ZodBoolean>;
    title: z.ZodString;
    message: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodOptional<z.ZodNumber>;
    endsAt: z.ZodOptional<z.ZodNumber>;
    dismissible: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    id: string;
    severity: "info" | "notice" | "degraded" | "outage";
    blocking: boolean;
    title: string;
    message?: string | undefined;
    startsAt?: number | undefined;
    endsAt?: number | undefined;
    dismissible?: boolean | undefined;
}, {
    id: string;
    severity: "info" | "notice" | "degraded" | "outage";
    title: string;
    blocking?: boolean | undefined;
    message?: string | undefined;
    startsAt?: number | undefined;
    endsAt?: number | undefined;
    dismissible?: boolean | undefined;
}>;
export type SystemAnnouncement = z.infer<typeof SystemAnnouncementSchema>;
//# sourceMappingURL=system-status.d.ts.map