import { useMemo } from 'react';

import type { EnrichedChainResponse, EnrichedStrike } from '@shared/enriched';
import { routeVerticalSpread, type SpreadKind, type RoutedSpreadAnalysis } from '@lib/analytics/verticalSpread';
import { extractSmile, type SmileCurve } from '@lib/analytics/smile';

const DEFAULT_RISK_FREE_RATE = 0.05;

export interface AnalysisInput {
  chain: EnrichedChainResponse | undefined;
  kind: SpreadKind;
  shortStrike: number | null;
  longStrike: number | null;
  venues?: readonly string[];
}

export interface AnalysisOutput {
  spot: number | null;
  smile: SmileCurve | null;
  analysis: RoutedSpreadAnalysis | null;
  T: number | null;
  r: number;
}

function computeTFromDte(dte: number | null | undefined): number | null {
  if (dte == null || dte <= 0) return null;
  return dte / 365.25;
}

export function useVerticalSpreadAnalysis({
  chain,
  kind,
  shortStrike,
  longStrike,
  venues,
}: AnalysisInput): AnalysisOutput {
  // Pre-index strikes by key so the router's lookups are O(1) per WS tick.
  // Separated from the analysis memo so the map only rebuilds when the
  // strikes array identity changes, not on every kind/strike selection.
  const strikeByKey = useMemo(() => {
    const m = new Map<number, EnrichedStrike>();
    for (const s of chain?.strikes ?? []) m.set(s.strike, s);
    return m;
  }, [chain?.strikes]);

  return useMemo(() => {
    if (!chain) return { spot: null, smile: null, analysis: null, T: null, r: DEFAULT_RISK_FREE_RATE };

    const spot = chain.stats.indexPriceUsd ?? chain.stats.spotIndexUsd ?? null;
    const T = computeTFromDte(chain.dte);

    const smile = spot != null && spot > 0 ? extractSmile(chain.strikes, spot) : null;

    let analysis: RoutedSpreadAnalysis | null = null;
    if (
      spot != null &&
      spot > 0 &&
      T != null &&
      shortStrike != null &&
      longStrike != null &&
      shortStrike !== longStrike
    ) {
      analysis = routeVerticalSpread({
        kind,
        shortStrike,
        longStrike,
        strikes: chain.strikes,
        strikeByKey,
        spot,
        T,
        r: DEFAULT_RISK_FREE_RATE,
        venues: venues as readonly import('@shared/enriched').VenueId[] | undefined,
      });
    }

    return { spot, smile, analysis, T, r: DEFAULT_RISK_FREE_RATE };
  }, [chain, kind, shortStrike, longStrike, venues, strikeByKey]);
}
