import type { FundedRunStatus } from './types.js';

const ALLOWED: Record<FundedRunStatus, FundedRunStatus[]> = {
  test_active: ['test_passed', 'test_failed'],
  test_passed: ['funded_active'],
  test_failed: [],
  funded_active: ['breached', 'withdrawn'],
  breached: [],
  withdrawn: [],
};

export function canTransition(from: FundedRunStatus, to: FundedRunStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: FundedRunStatus, to: FundedRunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal funded run transition: ${from} -> ${to}`);
  }
}
