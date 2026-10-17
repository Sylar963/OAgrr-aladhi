export { default as ArchitectView } from './ArchitectView';
export { useStrategyStore } from './strategy-store';
export { portfolioToBuilderLegs } from './portfolio-import';
export { pnlAtPrice, computeMetrics, detectStrategy } from './payoff';
export type { Leg, StrategyMetrics } from './payoff';
export type { PriceZone } from './zones-primitive';
export { useSpotCandles, isSpotCandleCurrency } from './queries';
export type { SpotCandle } from './queries';
export { pickCandleSpec } from './PayoffChartV2';
