import type { EnrichedStrike, EnrichedSide, SmileCurve, SmilePoint } from '@shared/enriched';

export type { SmileCurve, SmilePoint };

// Client-side mirror of core/enrichment.ts → computeSmile. Kept here because
// the enriched chain payload does not yet carry the smile curve — when the
// server starts emitting it, swap consumers to read response.smile and delete
// this module.
function avgIv(side: EnrichedSide): number | null {
  let sum = 0;
  let count = 0;
  for (const quote of Object.values(side.venues)) {
    if (!quote || quote.markIv == null) continue;
    sum += quote.markIv;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function interpAtStrike(points: SmilePoint[], targetStrike: number): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.strike - b.strike);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (targetStrike <= first.strike) return first.blendedIv;
  if (targetStrike >= last.strike) return last.blendedIv;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (targetStrike <= cur.strike) {
      if (prev.blendedIv == null || cur.blendedIv == null) return cur.blendedIv ?? prev.blendedIv;
      const span = cur.strike - prev.strike;
      if (span === 0) return cur.blendedIv;
      const t = (targetStrike - prev.strike) / span;
      return prev.blendedIv + t * (cur.blendedIv - prev.blendedIv);
    }
  }
  return null;
}

export function extractSmile(strikes: readonly EnrichedStrike[], spot: number): SmileCurve {
  const points: SmilePoint[] = strikes.map((s) => {
    const callIv = avgIv(s.call);
    const putIv = avgIv(s.put);
    const blended = s.strike < spot ? (putIv ?? callIv) : (callIv ?? putIv);
    return {
      strike: s.strike,
      moneyness: spot > 0 ? s.strike / spot : 0,
      callIv,
      putIv,
      blendedIv: blended,
    };
  });

  const atmIv = interpAtStrike(points, spot);
  const lowWing = interpAtStrike(points, spot * 0.9);
  const highWing = interpAtStrike(points, spot * 1.1);
  const skew =
    atmIv != null && atmIv > 0 && lowWing != null && highWing != null
      ? (lowWing - highWing) / atmIv
      : null;

  return { spot, points, atmIv, skew };
}
