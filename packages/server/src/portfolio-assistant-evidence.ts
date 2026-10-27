import {
  PortfolioAssistantEvidenceSchema,
  type PortfolioAssistantComparison,
  type PortfolioAssistantEvidence,
  type PortfolioAssistantMessage,
  type PortfolioAssistantSnapshot,
} from '@oggregator/protocol';
import type { PortfolioAssistantContext } from './portfolio-assistant-context-builder.js';

const CHANGE_METRICS = ['spotUsd', 'unrealizedPnlUsd', 'netDeltaCoin', 'netThetaUsd', 'netVegaUsd', 'equityUsd'] as const;

export function compareAssistantSnapshots(
  previous: PortfolioAssistantSnapshot,
  current: PortfolioAssistantSnapshot,
): PortfolioAssistantComparison | null {
  if (previous.source !== current.source || previous.underlying !== current.underlying ||
      previous.network !== current.network || previous.forwardDays !== current.forwardDays ||
      previous.generatedAt >= current.generatedAt) return null;
  if (current.source !== 'manual' && current.source !== 'paper' && current.network == null) return null;
  const positionsComparable = !previous.positionsTruncated && !current.positionsTruncated;
  const before = new Map(previous.positions.map((leg) => [leg.legId, leg]));
  const after = new Map(current.positions.map((leg) => [leg.legId, leg]));
  const positionChanges: PortfolioAssistantComparison['positionChanges'] = [];
  const markPnlChanges: NonNullable<PortfolioAssistantComparison['markPnlChanges']> = [];
  if (positionsComparable) {
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id);
      const next = after.get(id);
      const leg = next ?? old;
      if (!leg) continue;
      const instrument = `${leg.underlying} ${leg.expiry} ${leg.strike} ${leg.optionRight}`;
      const sameInstrument = old && next && old.underlying === next.underlying && old.expiry === next.expiry && old.strike === next.strike && old.optionRight === next.optionRight;
      if (sameInstrument && old.size === next.size && old.entryPriceUsd != null && old.entryPriceUsd === next.entryPriceUsd && old.markUsd != null && next.markUsd != null) {
        markPnlChanges.push({ legId: id, instrument, pnlChangeUsd: old.size * (next.markUsd - old.markUsd) });
      }
      if (sameInstrument && old.size === next.size) continue;
      positionChanges.push({
        legId: id,
        instrument,
        previousSize: old?.size ?? 0,
        currentSize: next?.size ?? 0,
      });
    }
  }
  return {
    previousGeneratedAt: previous.generatedAt,
    changes: CHANGE_METRICS.map((metric) => ({
      metric,
      previous: previous[metric],
      current: current[metric],
      change: previous[metric] == null || current[metric] == null ? null : current[metric] - previous[metric],
    })),
    positionChanges,
    positionsComparable,
    markPnlChanges,
    unattributedPnlChangeUsd: !positionsComparable || previous.unrealizedPnlUsd == null || current.unrealizedPnlUsd == null
      ? null : current.unrealizedPnlUsd - previous.unrealizedPnlUsd - markPnlChanges.reduce((sum, leg) => sum + leg.pnlChangeUsd, 0),
  };
}

export function buildAssistantEvidence(
  context: PortfolioAssistantContext,
  question: string,
  history: PortfolioAssistantMessage[],
): PortfolioAssistantEvidence {
  const snapshot: PortfolioAssistantSnapshot = {
    generatedAt: context.generatedAt,
    source: context.source,
    underlying: context.underlying,
    network: context.network ?? context.accountEquityFacts?.network ?? null,
    forwardDays: context.forwardDays,
    dataState: context.dataFreshness.state,
    spotUsd: context.headline.spotUsd,
    unrealizedPnlUsd: context.headline.unrealizedPnlUsd,
    netDeltaCoin: context.headline.netDeltaCoin,
    netThetaUsd: context.headline.netThetaUsd,
    netVegaUsd: context.headline.netVegaUsd,
    equityUsd: context.accountEquityFacts?.equityUsd ?? null,
    openLegCount: context.headline.openLegCount,
    positions: context.positions.slice(0, 100).map((leg) => ({
      legId: leg.legId, underlying: leg.underlying, expiry: leg.expiry, strike: leg.strike,
      optionRight: leg.optionRight, size: leg.size, markUsd: leg.currentMarkUsd,
      entryPriceUsd: leg.entryPriceUsd,
      markUpdatedAt: context.markTimestamps?.[leg.legId] ?? null,
    })),
    positionsTruncated: context.headline.openLegCount > context.positions.length,
  };
  const previous = [...history].reverse().find((message) =>
    message.role === 'assistant' && message.status === 'complete' && message.evidence != null,
  )?.evidence?.snapshot;
  const comparison = previous ? compareAssistantSnapshots(previous, snapshot) : null;
  const intent = context.contextSelection?.intent ?? 'portfolio';
  const explicit = context.positions.filter((leg) => question.includes(leg.expiry) || question.includes(String(leg.strike)));
  const metric = /theta/i.test(question) ? 'theta' : /vega/i.test(question) ? 'vega' : /gamma/i.test(question) ? 'gamma' : 'delta';
  const contributors = context.topContributors[metric].slice(0, 3);
  const relevant = explicit.length > 0 ? explicit : context.positions.filter((leg) =>
    contributors.some((item) => item.expiry === leg.expiry && (item.strike == null || item.strike === leg.strike)),
  );
  const contextSections: PortfolioAssistantEvidence['contextSections'] = ['portfolio'];
  if (context.horizonScenarios) contextSections.push('scenarios');
  if (context.marketFacts.underlyings.length > 0) contextSections.push('market');
  if (context.tradeHistoryFacts) contextSections.push('trades');
  if (context.accountEquityFacts) contextSections.push('account');
  const assumptions: PortfolioAssistantEvidence['assumptions'] = ['mark_not_execution', 'snapshot_not_quote_time'];
  if (context.horizonScenarios) assumptions.push('constant_iv_scenarios');
  if (intent !== 'theory') assumptions.push('expiry_not_margin');
  if (context.bookVsMarketFacts) assumptions.push('risk_neutral_not_forecast');
  if (comparison) assumptions.push('changes_not_attribution');
  return PortfolioAssistantEvidenceSchema.parse({
    version: 1, intent, snapshot, contextSections,
    relevantLegIds: relevant.map((leg) => leg.legId).slice(0, 100),
    assumptions,
    gaps: [...new Set([...context.limitations, ...context.marketFacts.unavailable])],
    actions: context.positions.length === 0 ? [] : context.horizonScenarios
      ? ['positions', 'scenario', 'alternatives'] : ['positions', 'alternatives'],
    comparison,
  });
}
