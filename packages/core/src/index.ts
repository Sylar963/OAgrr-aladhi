// types/common — shared primitives
export type { VenueId, OptionRight, DataSource } from './types/common.js';
export { VENUE_IDS } from './types/common.js';

export { logger, feedLogger } from './utils/logger.js';
export { analyzeFlowTrade, analyzeBlockTrade, analyzeFlowLegs, flowExecutionGroup } from './core/flow-analysis.js';

// core — canonical types, aggregator, registry, symbol utils
export type {
  OptionGreeks,
  EstimatedFees,
  PremiumValue,
  NormalizedQuote,
  NormalizedOptionContract,
  ChainRequest,
  VenueOptionChain,
  ComparisonRow,
  ComparisonChain,
  VenueDelta,
  VenueConnectionState,
  VenueStatus,
  WsSubscriptionRequest,
  SnapshotMeta,
  VenueFailure,
  ServerWsMessage,
  ClientWsMessage,
} from './core/types.js';
export { EMPTY_GREEKS } from './core/types.js';
export { ClientWsMessageSchema, ServerWsMessageSchema } from '@oggregator/protocol';

export { buildComparisonChain } from './core/aggregator.js';
export {
  registerAdapter,
  getAdapter,
  getAllAdapters,
  getRegisteredVenues,
} from './core/registry.js';
export {
  VenueSubscriptionCoordinator,
  type VenueSubscriptionHandle,
  type VenueSubscriptionListener,
} from './core/subscription-coordinator.js';
export { parseOptionSymbol, formatOptionSymbol, strikeKey } from './core/symbol.js';
export type { CanonicalOption } from './core/symbol.js';

export {
  buildEnrichedChain,
  computeIvSurface,
  computeIvSurfaceFine,
  computeSmile,
  computeTermStructure,
  computeDte,
  enrichComparisonRow,
  computeChainStats,
  computeGex,
  combineGex,
  interpTenor,
  FINE_DELTA_GRID,
  ULTRA_FINE_DELTA_GRID,
} from './core/enrichment.js';

export {
  buildIvSurfaceGrid,
  buildSurfaceAnalytics,
  buildSurfaceGridEntry,
} from './core/surface-grid.js';
export {
  computeGammaFlip,
  computeGammaWalls,
  GEX_WALL_FLOOR_M,
  type GammaWalls,
} from './core/gamma-walls.js';
export {
  computeGexProfile,
  combineGexProfile,
  GEX_PER_PCT_MOVE,
  GEX_PROFILE_MOVES,
  type GexProfilePoint,
} from './core/gex-profile.js';
export {
  computeVenueSurfaceRows,
  computeVenueTenorIvs,
} from './core/venue-tenor-iv.js';
export type { VenueTenorIv, VenueTenorIvInput } from './core/venue-tenor-iv.js';
export type {
  SurfaceGridEntry,
  BuildSurfaceGridOptions,
  SurfaceAnalytics,
  SurfaceGridEntryOptions,
} from './core/surface-grid.js';

export {
  computeCmmIvSurface,
  fillRowLinear,
  fitRowFromStrikesSvi,
  liftRowToGrid,
  smoothFineSurfaceRow,
  DEFAULT_CMM_TENORS,
  DENSE_CMM_TENORS,
  type CmmIvSurfaceRow,
} from './core/iv-surface-smoothing.js';

export type {
  EnrichedChainResponse,
  EnrichedStrike,
  EnrichedSide,
  VenueQuote,
  VenueExecutionQuote,
  IvSurfaceRow,
  IvSurfaceFineRow,
  SmilePoint,
  SmileCurve,
  GexStrike,
  ChainStats,
  TermStructure,
  IvTenor,
  IvHistoryPoint,
  IvHistoryExtrema,
  IvHistoryTenorResult,
  IvHistoryResponse,
} from './core/enrichment.js';

export {
  OI_EPSILON,
  bootstrapNaivePosition,
  signOiDelta,
  applyBookInterval,
} from './core/dealer-book.js';
export type { DealerPosition, OiSnapshotInput, BookLookup } from './core/dealer-book.js';

// feeds/shared — adapter interfaces
export type {
  OptionVenueAdapter,
  VenueCapabilities,
  StreamHandlers,
} from './feeds/shared/types.js';
export { BaseAdapter } from './feeds/shared/base.js';
export { TopicWsClient, type TopicWsClientOptions } from './feeds/shared/topic-ws-client.js';
export type { QuoteRecorder, QuoteRecorderEvent } from './feeds/shared/sdk-base.js';

// runtime
export {
  ChainRuntime,
  ChainRuntimeRegistry,
  ChainProjection,
  VenueHealthManager,
  mergeEnrichedStrikes,
  type ChainRuntimeDeltaEvent,
  type ChainRuntimeEvent,
  type ChainRuntimeListener,
  type ChainRuntimeOptions,
  type ChainRuntimeSnapshotEvent,
  type ChainRuntimeStatusEvent,
  type ChainProjectionDelta,
} from './runtime/chain/index.js';

// runtime
export {
  SpotRuntime,
  type SpotRuntimeEvent,
  type SpotRuntimeHealth,
  type SpotRuntimeListener,
  type SpotRuntimeOptions,
  type SpotRuntimeSnapshotEvent,
  type SpotSnapshot,
  type PerpCandle,
  PerpCandleRuntime,
  type PerpCandleRuntimeOptions,
  type PerpCandleSnapshot,
  type PerpTicker,
  PerpTickerRuntime,
  type PerpTickerRuntimeOptions,
  type PerpTickerSnapshot,
} from './runtime/spot/index.js';

export {
  IndexPriceRuntime,
  type IndexPriceRuntimeStartOptions,
} from './runtime/index-price/index-price-runtime.js';

export { toGateioRestBase, fromGateioRestBase } from './feeds/gateio/aliases.js';
export {
  fetchGateioSettlement,
  type FetchGateioSettlementArgs,
  type GateioSettlementResult,
} from './feeds/gateio/settlement.js';

// services
export {
  InstrumentCandleService,
  instrumentCandleService,
  InstrumentCandlesError,
  type InstrumentCandleServiceOptions,
} from './services/instrument-candles.js';
export {
  MarkHistoryBuffer,
  mergeBaseBuckets,
  type MarkHistoryBufferOptions,
  type RawCandle,
} from './services/mark-history-buffer.js';
export { DvolService, type DvolSnapshot, type DvolCandle, type HvPoint } from './services/dvol.js';
export {
  SpotCandleService,
  type SpotCandle,
  type SpotCandleCurrency,
  type SpotCandleResolutionSec,
} from './services/spot-candles.js';
export { realizedVol, rollingRealizedVol, type RealizedVolPoint } from './services/realized-vol.js';
export {
  buildTimeAtPrice,
  niceStep,
  type TimeAtPriceCandle,
  type TimeAtPriceLevel,
  type TimeAtPriceOptions,
  type TimeAtPriceProfile,
  type VolByPriceLevel,
} from './services/time-at-price.js';
export {
  black76Delta,
  type BreakEvenCandidate,
  breakEvenHistory,
  breakEvenLevel,
  type BreakEvenPathPoint,
  type BreakEvenSmile,
  daysToExpiry,
  historicalExceedance,
  horizonLogReturns,
  type HorizonReturns,
  impliedExceedance,
  projectBreakEven,
  selectBreakEvenStrikes,
} from './services/break-even.js';
export {
  baselineTenorDays,
  buildVolForecastModel,
  buildVolRichness,
  EXCESS_PREMIUM_FAIR_BAND,
  forecastFromCloses,
  richnessState,
  termStructure,
  WEEKEND_VARIANCE_WEIGHT,
  weekendAdjustedVol,
  weekendShare,
  withVenueBaseline,
  type ExcessPremiumHistory,
  type ForecastCurvePoint,
  type IntradayIvMove,
  type PremiumBaseline,
  type PremiumBaselineSource,
  type RichnessState,
  type RichnessTenor,
  type TenorIvSeries,
  type TenorRichness,
  type TermStructureState,
  type VolConeBand,
  type VolForecastModel,
  type VolForecastSummary,
  type VolRichness,
  type VolRichnessInput,
} from './services/vol-richness.js';
export {
  backward,
  fitGaussianHmm,
  forward,
  gaussianLogPdf,
  logSumExp,
  smoothedPosteriors,
  viterbi,
  type BackwardResult,
  type FitOptions,
  type FitResult,
  type ForwardResult,
  type HmmModel,
  type ViterbiResult,
} from './services/regime-hmm.js';
export {
  applyStandardization,
  deriveDirection,
  fitStandardization,
  interpBasisToTenor,
  labelStatesByVolLevel,
  normalizeLegacyLabel,
  RegimeService,
  type BasisPoint,
  type RegimeDirection,
  type RegimeInputs,
  type RegimeLabel,
  type RegimePersistedModel,
  type RegimePersistedObservation,
  type RegimePersistence,
  type RegimeQueryResult,
  type RegimeServiceDeps,
  type RegimeServiceOptions,
  type StandardizationParams,
} from './services/regime.js';
export {
  createWorkerHmmFitter,
  inProcessHmmFitter,
  type HmmFitter,
} from './services/regime-fit.js';
export {
  fitSvi,
  sviIv,
  sviTotalVariance,
  type SviParams,
  type FitPoint as SviFitPoint,
} from './services/svi-fit.js';
export {
  IvHistoryService,
  MIN_RANK_HISTORY_DAYS,
  type IvHistoryDeps,
  type IvHistoryOptions,
  type IvHistoryPersistence,
  type IvHistoryQueryOptions,
  type IvSurfaceSnapshot,
  type IvHistoryPointSource,
  type PersistedIvHistoryPoint,
  withFractionalDte,
} from './services/iv-history.js';
export {
  TradeRuntime,
  getDeribitTradeCurrency,
  getDeribitUnderlyingFromInstrument,
  normalizeTradeUnderlying,
  type TradeEvent,
  type TradeRuntimeHealth,
} from './runtime/trades/index.js';
export {
  BlockTradeRuntime,
  type BlockTradeEvent,
  type BlockTradeLeg,
  type BlockTradeRuntimeHealth,
  type BlockTradeSource,
} from './runtime/block-trades/index.js';
export {
  mergeHeatmapColumns,
  type VolHeatmapHistory,
  VolHeatmapRuntime,
  type VolHeatmapRuntimeOptions,
} from './runtime/vol-heatmap/index.js';
export {
  type ExitBookRuntime,
  OrderBookCapacityError,
  type OrderBookLease,
  OrderBookRuntime,
  type OrderBookRuntimeOptions,
  OrderBookUnavailableError,
  ThalexExitBooks,
} from './runtime/order-book/index.js';
export type {
  BookLevel,
  BookMark,
  BookSide,
  BookSyncState,
  OrderBookSnapshot,
} from './liquidity/types.js';
export {
  costToFill,
  type DepthBand,
  type DepthPoint,
  depthCurve,
  depthWithin,
  type FillEstimate,
  referencePrice,
} from './liquidity/analytics.js';
export { isThalexBookInstrument } from './feeds/thalex/book.js';
export type { ThalexBookAuth } from './feeds/thalex/book-feed.js';
export {
  buildBlockTradeUid,
  buildLiveTradeUid,
  computeBlockTradeAmounts,
  computeLiveTradeAmounts,
  getVenueContractMultiplier,
  isInversePremiumVenue,
  parseTradeInstrument,
  type ParsedTradeInstrument,
  type TradeAmounts,
} from './trade-persistence.js';

// Black-76 helpers (re-exported for downstream Greek work)
export {
  d1,
  pdf,
  cdf,
  price76,
  vega76,
  delta76,
  gamma76,
  solveIv,
  thetaPerDay,
  yearsToExpiry,
} from './feeds/thalex/bs-solver.js';

// thesis gate (pure)
export {
  atRiskBandUsd,
  classifyBias,
  classifyBook,
  contextDiff,
  firedCandle,
  gateDecision,
  isBeyondLevel,
  oppositeDirection,
  rebaseToMark,
  thesisStatus,
  THESIS_AT_RISK_FLOOR_PCT,
  THESIS_AT_RISK_MOVE_FRACTION,
  THESIS_BIAS_THRESHOLD,
  THESIS_DIFF_THRESHOLDS,
  THESIS_GATE_SHOWN_DEDUPE_MS,
  THESIS_MIN_BAND_PCT,
  THESIS_MIN_PNL_USD,
  THESIS_REVERSAL_COOLDOWN_MS,
  THESIS_WAIT_MS,
  type ClassifyBookInput,
  type GateDecision,
  type GateDecisionInput,
  type ThesisCandle,
  type ThesisLegWithMark,
  type ThesisRule,
  type ThesisStatusInput,
} from './thesis/index.js';
export { expiryInstantMs } from './portfolio/index.js';

// portfolio module
export type {
  LinearPosition,
  PositionLeg,
  MarkContext,
  MarkProvider,
  PositionStore,
  PositionStoreEvent,
  PositionStoreListener,
  PortfolioPersistence,
} from './portfolio/index.js';
export {
  InMemoryPositionStore,
  generateLegId,
  vanna76,
  volga76,
  aggregateGreeksByStrike,
  aggregateGreeksByExpiry,
  breakEvenIvCurve,
  buildPortfolioHorizonScenarios,
  buildPortfolioPnlCurve,
  analyzeExpiryStructure,
  type ExpiryRiskWindow,
  DEFAULT_TAKER_FEE_PREMIUM_CAP,
  DEFAULT_TAKER_FEE_RATE,
  defaultTakerFeeUsd,
  evaluateStructure,
  STRUCTURE_ASSUMPTIONS,
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
  type PortfolioHorizonScenarioCell,
  type PortfolioHorizonScenarios,
  computeTotals,
  attachMarks,
  legMarkFromShockedIv,
  applyVolShock,
  computeShockPnl,
  computeShockGrid,
  computeEntryShockGrid,
  computeEntryVolDrift,
  computePnlAttribution,
  entryAnchorFromFills,
  type EntryAnchor,
  type EntryFill,
  getShockGridMeta,
  foldManualLeg,
  findExistingForInput,
  naturalKeyOf,
  buildPortfolioAssistantRiskFacts,
  rankPortfolioRiskContributors,
  type PortfolioAssistantPositionFact,
  type PortfolioAssistantRiskFacts,
  type PortfolioRiskContributor,
  type PortfolioRiskMetric,
  type FoldContext,
  detectStrategyGroups,
  aggregateCloseNow,
  bookProblem,
  CLOSE_NOW_BOOK_SILENCE_MS,
  CLOSE_NOW_MIN_GIVE_BACK_BASE_USD,
  CLOSE_NOW_SPREAD_MIN_SAMPLES,
  CLOSE_NOW_SPREAD_SAMPLE_MS,
  CLOSE_NOW_SPREAD_WINDOW_MS,
  CloseNowTracker,
  evaluateCloseNowLeg,
  type ExitBookLookup,
  type ExitBookSource,
  exitInstrumentOf,
  exitVenueOf,
} from './portfolio/index.js';
export { cappedTakerFeeUsd, THALEX_OPTION_FEE_RATE, VENUE_FEE_CAP } from './core/fees.js';
export {
  PortfolioRuntime,
  type ChainSurfaceProvider,
  type PortfolioRuntimeEvent,
  type PortfolioRuntimeListener,
  type PortfolioRuntimeOptions,
  type PortfolioSnapshotEvent,
  type PortfolioDeltaEvent,
  type PortfolioErrorEvent,
  type PortfolioMetricsComputation,
} from './runtime/portfolio/index.js';

// private (per-user, authenticated) venue adapters
export {
  DerivePrivateClient,
  type DerivePrivateCreds,
  type DerivePositionsListener,
  signLoginMessage as signDeriveLoginMessage,
  recoverSignerAddress as recoverDeriveSignerAddress,
  generateSessionKey as generateDeriveSessionKey,
  type DeriveSessionKeyPair,
} from './feeds/derive-private/index.js';
export {
  ParadexAuthError,
  ParadexPrivateClient,
  type ParadexPrivateCreds,
  type ParadexPositionsListener,
  decodeParadexJwtClaims,
} from './feeds/paradex-private/index.js';
export {
  ThalexPrivateClient,
  type ThalexPrivateCreds,
  type ThalexPositionsListener,
  mintAuthToken as mintThalexAuthToken,
  type ThalexAccountEquity,
  type ThalexAccountLedger,
  type ThalexAccountMargin,
  type ThalexCashHolding,
  type ThalexCashTransaction,
} from './feeds/thalex-private/index.js';

// feeds — venue adapters
export { DeribitWsAdapter } from './feeds/deribit/index.js';
export { OkxWsAdapter } from './feeds/okx/index.js';
export { BinanceWsAdapter } from './feeds/binance/index.js';
export { BybitWsAdapter } from './feeds/bybit/index.js';
export { DeriveWsAdapter } from './feeds/derive/index.js';
export { CoincallWsAdapter } from './feeds/coincall/index.js';
export { ThalexWsAdapter } from './feeds/thalex/index.js';
export { GateioWsAdapter } from './feeds/gateio/index.js';
export { ParadexWsAdapter } from './feeds/paradex/index.js';
export { FeedWorkerHost, WorkerVenueAdapter } from './feeds/worker/feed-worker-client.js';
export { reconcileFlowPosition, flowPositionEffect, type FlowIntervalTape } from './core/flow-position.js';
export { FlowOiRecorder } from './core/flow-oi-recorder.js';
