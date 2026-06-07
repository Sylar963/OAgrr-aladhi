import type { FundedRouteType, FundedRunStatus, FundedSettlementCadence } from '@oggregator/db';

export type { FundedRouteType, FundedRunStatus, FundedSettlementCadence };

export interface ChallengeTemplate {
  id: string;
  name: string;
  routeType: FundedRouteType;
  testDepositMinUsd: number | null;
  testProfitTargetPct: number | null;
  testMaxDrawdownPct: number | null;
  fundedAbc: number;
  abcFloorPct: number;
  profitSplitPct: number;
  settlementCadence: FundedSettlementCadence;
  maxRunsPerUser: number;
}

export interface FundedRun {
  id: string;
  userId: string;
  templateId: string;
  paperAccountId: string;
  routeType: FundedRouteType;
  status: FundedRunStatus;
  depositUsd: number | null;
  abcCredited: number;
}

export type EquitySnapshotFn = (paperAccountId: string) => Promise<number>;

export interface TestRouteOutcome {
  result: 'pass' | 'fail' | 'continue';
}

export interface SettlementComputation {
  cumulativeProfitUsd: number;
  traderShareUsd: number;
  drawdownPct: number;
  floorBreached: boolean;
}
