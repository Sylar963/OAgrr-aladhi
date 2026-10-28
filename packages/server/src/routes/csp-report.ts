import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MAX_REPORT_BYTES = 16 * 1024;

// Legacy `report-uri` body: { "csp-report": {...} } with kebab-case fields.
const LegacyReportSchema = z.object({
  'csp-report': z
    .object({
      'document-uri': z.string().optional(),
      'violated-directive': z.string().optional(),
      'effective-directive': z.string().optional(),
      'blocked-uri': z.string().optional(),
      disposition: z.string().optional(),
    })
    .passthrough(),
});

// Reporting API body: an array of { type, body: {...} } with camelCase fields.
const ReportingApiSchema = z.array(
  z
    .object({
      type: z.string(),
      body: z
        .object({
          documentURL: z.string().optional(),
          effectiveDirective: z.string().optional(),
          blockedURL: z.string().optional(),
          disposition: z.string().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
);

export interface CspViolation {
  page: string | null;
  directive: string | null;
  blocked: string | null;
  disposition: string | null;
}

/** Path only for pages, origin only for blocked URLs: no query strings, tokens or fragments. */
function pathOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function blockedOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    // Keywords such as `inline`, `eval`, `trusted-types-sink`.
    return url.slice(0, 40);
  }
}

export function parseCspReports(body: unknown): CspViolation[] {
  const legacy = LegacyReportSchema.safeParse(body);
  if (legacy.success) {
    const r = legacy.data['csp-report'];
    return [
      {
        page: pathOf(r['document-uri']),
        directive: r['effective-directive'] ?? r['violated-directive'] ?? null,
        blocked: blockedOf(r['blocked-uri']),
        disposition: r.disposition ?? null,
      },
    ];
  }
  const modern = ReportingApiSchema.safeParse(body);
  if (modern.success) {
    return modern.data
      .filter((report) => report.type === 'csp-violation')
      .map(({ body: r }) => ({
        page: pathOf(r.documentURL),
        directive: r.effectiveDirective ?? null,
        blocked: blockedOf(r.blockedURL),
        disposition: r.disposition ?? null,
      }));
  }
  return [];
}

/**
 * Collects the main app's CSP violation reports so the policy can be enforced on evidence
 * (B0 T08). Log only: no database writes, and nothing from the report is echoed back.
 */
export async function cspReportRoute(app: FastifyInstance) {
  for (const type of ['application/csp-report', 'application/reports+json']) {
    app.addContentTypeParser(type, { parseAs: 'string', bodyLimit: MAX_REPORT_BYTES }, (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, null);
      }
    });
  }

  app.post(
    '/csp-report',
    { bodyLimit: MAX_REPORT_BYTES, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      for (const violation of parseCspReports(request.body).slice(0, 20)) {
        request.log.warn({ csp: violation }, 'csp violation');
      }
      return reply.status(204).send();
    },
  );
}
