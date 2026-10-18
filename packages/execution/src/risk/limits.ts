import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, type LiveActor } from '@oggregator/protocol';
import { z } from 'zod';
import { assertPrivate, ensurePrivateDir } from '../fs-permissions.js';

/**
 * Thalex account caps (trading-information/portfolio-margin, checked 2026-10-17). Open-order cash
 * size = sum of order amounts × underlying price, per underlying per side.
 */
export const THALEX_CAPS = {
  maxOpenOrders: 200,
  openNotionalPerSideUsd: { delta1: 1_000_000, option: 2_000_000 },
} as const;
/** No limit may be configured above this share of a Thalex cap (charter §6.8). */
const CAP_SHARE = 0.8;

export const RiskLimitsSchema = z
  .object({
    /** `observe` journals failed checks without blocking; testnet starts in `enforce`. */
    mode: z.enum(['observe', 'enforce']),
    /** Per order, amount × underlying price, the same basis Thalex uses for its caps. */
    maxOrderNotionalUsd: z.number().positive(),
    maxContractsPerOrder: z.number().positive(),
    maxOpenOrders: z
      .number()
      .int()
      .positive()
      .max(Math.floor(THALEX_CAPS.maxOpenOrders * CAP_SHARE)),
    maxOpenNotionalPerSideUsd: z
      .object({
        delta1: z
          .number()
          .positive()
          .max(THALEX_CAPS.openNotionalPerSideUsd.delta1 * CAP_SHARE),
        option: z
          .number()
          .positive()
          .max(THALEX_CAPS.openNotionalPerSideUsd.option * CAP_SHARE),
      })
      .strict(),
    /** How far a limit price may sit from mark, in percent, on the aggressive side. */
    collarPct: z
      .object({
        option: z.number().positive().max(50),
        delta1: z.number().positive().max(5),
      })
      .strict(),
    /** Free margin that must remain after `required_margin_for_order`, in percent. */
    marginHeadroomPct: z.number().min(0).max(100),
    maxOrdersPerSecond: z.number().positive().max(10),
    /** Older market data than this fails the freshness check. */
    maxMarketAgeMs: z.number().int().positive().max(30_000),
  })
  .strict();
export type RiskLimits = z.infer<typeof RiskLimitsSchema>;

/** Deliberately small: these are the limits every actor starts with on testnet. */
export const DEFAULT_LIMITS: RiskLimits = {
  mode: 'enforce',
  maxOrderNotionalUsd: 250_000,
  maxContractsPerOrder: 2,
  maxOpenOrders: 10,
  maxOpenNotionalPerSideUsd: { delta1: 500_000, option: 500_000 },
  collarPct: { option: 15, delta1: 1 },
  marginHeadroomPct: 50,
  maxOrdersPerSecond: 2,
  maxMarketAgeMs: 5_000,
};

const OverrideSchema = z
  .object({
    mode: RiskLimitsSchema.shape.mode.optional(),
    maxOrderNotionalUsd: z.number().optional(),
    maxContractsPerOrder: z.number().optional(),
    maxOpenOrders: z.number().optional(),
    maxOpenNotionalPerSideUsd: z
      .object({ delta1: z.number().optional(), option: z.number().optional() })
      .strict()
      .optional(),
    collarPct: z
      .object({ option: z.number().optional(), delta1: z.number().optional() })
      .strict()
      .optional(),
    marginHeadroomPct: z.number().optional(),
    maxOrdersPerSecond: z.number().optional(),
    maxMarketAgeMs: z.number().optional(),
  })
  .strict();

export interface ResolvedLimits {
  limits: RiskLimits;
  source: 'default' | 'override';
  /** Short hash of the effective limits; every risk decision records it. */
  version: string;
}

function versionOf(limits: RiskLimits): string {
  return createHash('sha256').update(canonicalJson(limits)).digest('hex').slice(0, 12);
}

/**
 * Limits per actor (charter D9): defaults, optionally overridden by an owner-only file per actor.
 * The merged result is validated against the full schema, so an override can never exceed the
 * ceilings. A broken override file fails closed: the actor gets no limits and cannot trade.
 */
export class RiskLimitBook {
  private readonly dir: string;

  constructor(stateDir: string) {
    this.dir = join(stateDir, 'limits');
    ensurePrivateDir(this.dir);
  }

  pathFor(actor: LiveActor): string {
    const digest = createHash('sha256')
      .update(`${actor.clerkUserId}|${actor.accountId}`)
      .digest('hex')
      .slice(0, 32);
    return join(this.dir, `limits-${digest}.json`);
  }

  limitsFor(actor: LiveActor): ResolvedLimits {
    const path = this.pathFor(actor);
    if (!existsSync(path)) {
      return { limits: DEFAULT_LIMITS, source: 'default', version: versionOf(DEFAULT_LIMITS) };
    }
    assertPrivate(path, 0o077);
    const override = OverrideSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    const limits = RiskLimitsSchema.parse({
      ...DEFAULT_LIMITS,
      ...override,
      maxOpenNotionalPerSideUsd: {
        ...DEFAULT_LIMITS.maxOpenNotionalPerSideUsd,
        ...override.maxOpenNotionalPerSideUsd,
      },
      collarPct: { ...DEFAULT_LIMITS.collarPct, ...override.collarPct },
    });
    return { limits, source: 'override', version: versionOf(limits) };
  }
}
