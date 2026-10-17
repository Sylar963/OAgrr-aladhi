import type { OptionRight } from '../../types/common.js';

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
// An expiry this close to settlement has a meaningless IV-per-tick and is about to roll out.
const MIN_EXPIRY_LEAD_MS = 2 * DAY_MS;

export interface HeatmapInstrument {
  name: string;
  strike: number;
  right: OptionRight;
  expiry: number;
}

export interface HeatmapSelectionOptions {
  now: number;
  spot: number;
  /** ATM vol as a fraction; sets the strike band width. */
  atmVol: number;
  targetDays?: number;
  bandSigmas?: number;
  minStrikesPerExpiry?: number;
}

export interface HeatmapSelection {
  expiries: number[];
  instruments: HeatmapInstrument[];
  /** Per expiry, the at-the-money call whose ticker supplies the forward. */
  forwardSources: Map<number, string>;
}

/**
 * DVOL's window: the two listed expiries bracketing `targetDays`. Within each, strikes inside
 * ±`bandSigmas` standard deviations of spot, out-of-the-money side only (ITM premiums are mostly
 * intrinsic, so a one-tick move swings their IV wildly). The strike nearest spot keeps both sides.
 */
export function selectHeatmapInstruments(
  all: readonly HeatmapInstrument[],
  options: HeatmapSelectionOptions,
): HeatmapSelection {
  const {
    now,
    spot,
    atmVol,
    targetDays = 30,
    bandSigmas = 0.5,
    minStrikesPerExpiry = 6,
  } = options;

  const target = now + targetDays * DAY_MS;
  const listed = [...new Set(all.map((i) => i.expiry))]
    .filter((e) => e - now >= MIN_EXPIRY_LEAD_MS)
    .sort((a, b) => a - b);
  const below = listed.filter((e) => e <= target).at(-1);
  const above = listed.find((e) => e > target);
  const expiries = [below, above].filter((e): e is number => e != null);

  const instruments: HeatmapInstrument[] = [];
  const forwardSources = new Map<number, string>();

  for (const expiry of expiries) {
    const legs = all.filter((i) => i.expiry === expiry);
    const strikes = [...new Set(legs.map((i) => i.strike))].sort(
      (a, b) => Math.abs(Math.log(a / spot)) - Math.abs(Math.log(b / spot)),
    );
    const band = bandSigmas * atmVol * Math.sqrt((expiry - now) / YEAR_MS);
    const chosen = strikes.filter(
      (k, i) => i < minStrikesPerExpiry || Math.abs(Math.log(k / spot)) <= band,
    );
    const atmStrike = chosen[0];

    for (const leg of legs) {
      if (!chosen.includes(leg.strike)) continue;
      const otm = leg.right === 'call' ? leg.strike >= spot : leg.strike < spot;
      if (otm || leg.strike === atmStrike) instruments.push(leg);
      if (leg.strike === atmStrike && leg.right === 'call') forwardSources.set(expiry, leg.name);
    }
  }

  return { expiries, instruments, forwardSources };
}
