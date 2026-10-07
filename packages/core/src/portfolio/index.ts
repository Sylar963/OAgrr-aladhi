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
  foldManualLeg,
  findExistingForInput,
  naturalKeyOf,
  type FoldContext,
} from './position-fold.js';
export { detectStrategyGroups } from './strategy-groups.js';
