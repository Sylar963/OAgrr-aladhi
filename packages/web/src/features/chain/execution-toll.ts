export interface ExecutionToll {
  mid: number;
  usd: number;
  pct: number;
}

export function executionToll(bid: number | null, ask: number | null): ExecutionToll | null {
  if (
    bid == null ||
    ask == null ||
    !Number.isFinite(bid) ||
    !Number.isFinite(ask) ||
    bid <= 0 ||
    ask <= 0 ||
    ask < bid
  )
    return null;

  const mid = bid / 2 + ask / 2;
  const usd = (ask - bid) / 2;
  return { mid, usd, pct: (usd / mid) * 100 };
}
