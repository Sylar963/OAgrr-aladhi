import type { TenorRichness, VolRichness, VolRichnessState } from '@oggregator/protocol';

/** Vol points with sign, e.g. +2.3 pts; inputs are IV fractions. */
export function fmtVolPts(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '–';
  const pts = value * 100;
  const sign = pts > 0 ? '+' : pts < 0 ? '−' : '';
  return `${sign}${Math.abs(pts).toFixed(decimals)} pts`;
}

export function fmtZ(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '–';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1)}σ`;
}

export function fmtPercentile(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '–' : `p${value.toFixed(0)}`;
}

/** Richness tenor whose usual premium serves this expiry (matches the server's 14-day split). */
export function richnessTenorFor(richness: VolRichness, dteDays: number): TenorRichness {
  return dteDays <= 14 ? richness.tenors['7d'] : richness.tenors['30d'];
}

export interface ExpiryRichness {
  forecastVol: number | null;
  usualPremium: number | null;
  ivMinusForecast: number | null;
  excessPremium: number | null;
  state: VolRichnessState;
}

function interpolateForecast(richness: VolRichness, dteDays: number): number | null {
  const curve = richness.forecastCurve.filter((point) => point.forecastVol != null);
  if (curve.length === 0) return null;
  const first = curve[0]!;
  const last = curve[curve.length - 1]!;
  if (dteDays <= first.dteDays) return first.forecastVol;
  if (dteDays >= last.dteDays) return last.forecastVol;
  for (let index = 1; index < curve.length; index += 1) {
    const right = curve[index]!;
    if (right.dteDays < dteDays) continue;
    const left = curve[index - 1]!;
    const weight = (dteDays - left.dteDays) / (right.dteDays - left.dteDays);
    return left.forecastVol! + (right.forecastVol! - left.forecastVol!) * weight;
  }
  return last.forecastVol;
}

/** Excess premium for an arbitrary expiry: its ATM IV against the server's forecast curve. */
export function expiryRichness(
  richness: VolRichness,
  atmIv: number | null,
  dteDays: number,
): ExpiryRichness {
  const forecastVol = interpolateForecast(richness, dteDays);
  const usualPremium = richnessTenorFor(richness, dteDays).premiumBaseline.medianSpread;
  const ivMinusForecast = atmIv != null && forecastVol != null ? atmIv - forecastVol : null;
  const excessPremium =
    ivMinusForecast != null && usualPremium != null ? ivMinusForecast - usualPremium : null;
  const band = richness.fairBand;
  const state: VolRichnessState =
    excessPremium == null
      ? 'unavailable'
      : excessPremium <= -band
        ? 'cheap'
        : excessPremium >= band
          ? 'rich'
          : 'fair';
  return { forecastVol, usualPremium, ivMinusForecast, excessPremium, state };
}
