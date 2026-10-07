export {
  buildPortfolioAssistantRiskFacts,
  rankPortfolioRiskContributors,
  type PortfolioAssistantPositionFact,
  type PortfolioAssistantRiskFacts,
  type PortfolioRiskContributor,
  type PortfolioRiskMetric,
} from './assistant-facts.js';
export type {
  PositionLeg,
  MarkContext,
  MarkProvider,
  PositionStore,
  PositionStoreEvent,
  PositionStoreListener,
  PortfolioPersistence,
} from './types.js';
export { InMemoryPositionStore, generateLegId } from './in-memory-store.js';
export { vanna76, volga76 } from './greeks-extra.js';
export {
  aggregateGreeksByStrike,
  aggregateGreeksByExpiry,
  breakEvenIvCurve,
  computeTotals,
  attachMarks,
  legMarkFromShockedIv,
} from './aggregator.js';
export { applyVolShock, computeShockPnl, computeShockGrid, getShockGridMeta } from './scenarios.js';
export {
  buildPortfolioHorizonScenarios,
  buildPortfolioPnlCurve,
  type PortfolioHorizonScenarioCell,
  type PortfolioHorizonScenarios,
} from './pnl-curve.js';
export { analyzeExpiryStructure, type ExpiryRiskWindow } from './expiry-structure.js';
export {
  DEFAULT_TAKER_FEE_PREMIUM_CAP,
  DEFAULT_TAKER_FEE_RATE,
  defaultTakerFeeUsd,
  evaluateStructure,
  STRUCTURE_ASSUMPTIONS,
  type EvaluatedProposedLeg,
  type EvaluateStructureInput,
  type IncrementalBasis,
  type ProposedLegQuote,
  type ProposedStructureLeg,
  type StructureBudget,
  type StructureEvaluation,
  type StructureEvaluationStatus,
  type StructurePayoffAtExpiry,
  type StructureRiskSummary,
  type StructureScenarioCell,
} from './structure-evaluator.js';
export {
  findUncoveredShorts,
  searchStructures,
  STRUCTURE_SEARCH_MAX_CANDIDATES,
  STRUCTURE_SEARCH_MAX_LIMIT,
  STRUCTURE_SEARCH_MAX_WIDTH,
  STRUCTURE_SEARCH_STRIKE_BAND,
  STRUCTURE_SEARCH_TIME_BUDGET_MS,
  type StructureSearchCandidate,
  type StructureSearchComponent,
  type StructureSearchContract,
  type StructureSearchFamily,
  type StructureSearchInput,
  type StructureSearchLeg,
  type StructureSearchLegRole,
  type StructureSearchQuoteSide,
  type StructureSearchRanking,
  type StructureSearchRepair,
  type StructureSearchRepairKind,
  type StructureSearchRepairOption,
  type StructureSearchResult,
  type StructureSearchStatus,
  type StructureSearchView,
  type UncoveredShort,
} from './structure-search.js';
export {
  foldManualLeg,
  findExistingForInput,
  naturalKeyOf,
  type FoldContext,
} from './position-fold.js';
export { detectStrategyGroups } from './strategy-groups.js';
