import type { OptionsActivity, OptionsActivitySide } from '@oggregator/protocol';

export interface OptionsActivityInput {
  symbol: string;
  expiry: string;
  strike: number;
  right: 'call' | 'put';
  multiplier: number;
  volume: number | null;
  openInterest: number | null;
}

function emptySide(): OptionsActivitySide {
  return {
    contracts: 0,
    volumeObserved: 0,
    oiObserved: 0,
    volume: null,
    openInterest: null,
    volumeNotionalUsd: null,
    oiNotionalUsd: null,
  };
}

function emptyActivity(): OptionsActivity {
  return { call: emptySide(), put: emptySide(), putCallVolumeRatio: null, putCallOiRatio: null };
}

function quantity(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function add(side: OptionsActivitySide, input: OptionsActivityInput, spot: number | null): void {
  side.contracts++;
  const volume = quantity(input.volume);
  const oi = quantity(input.openInterest);
  const scale = spot != null && spot > 0 && input.multiplier > 0 ? spot * input.multiplier : null;
  if (volume != null) {
    side.volumeObserved++;
    side.volume = (side.volume ?? 0) + volume;
    if (scale != null) side.volumeNotionalUsd = (side.volumeNotionalUsd ?? 0) + volume * scale;
  }
  if (oi != null) {
    side.oiObserved++;
    side.openInterest = (side.openInterest ?? 0) + oi;
    if (scale != null) side.oiNotionalUsd = (side.oiNotionalUsd ?? 0) + oi * scale;
  }
}

function finish(activity: OptionsActivity): OptionsActivity {
  const { call, put } = activity;
  if (
    call.volumeObserved === call.contracts &&
    put.volumeObserved === put.contracts &&
    call.volume != null &&
    call.volume > 0 &&
    put.volume != null
  ) {
    activity.putCallVolumeRatio = put.volume / call.volume;
  }
  if (
    call.oiObserved === call.contracts &&
    put.oiObserved === put.contracts &&
    call.openInterest != null &&
    call.openInterest > 0 &&
    put.openInterest != null
  ) {
    activity.putCallOiRatio = put.openInterest / call.openInterest;
  }
  return activity;
}

export function aggregateOptionsActivity(
  inputs: readonly OptionsActivityInput[],
  spot: number | null,
) {
  const summary = emptyActivity();
  const expiries = new Map<string, OptionsActivity>();
  const strikes = new Map<number, OptionsActivity>();
  const cells = new Map<string, { expiry: string; strike: number; activity: OptionsActivity }>();
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.symbol)) continue;
    seen.add(input.symbol);
    const expiry = expiries.get(input.expiry) ?? emptyActivity();
    expiries.set(input.expiry, expiry);
    const strike = strikes.get(input.strike) ?? emptyActivity();
    strikes.set(input.strike, strike);
    const key = `${input.expiry}:${input.strike}`;
    const cell = cells.get(key) ?? {
      expiry: input.expiry,
      strike: input.strike,
      activity: emptyActivity(),
    };
    cells.set(key, cell);
    for (const activity of [summary, expiry, strike, cell.activity])
      add(activity[input.right], input, spot);
  }
  return {
    summary: finish(summary),
    byExpiry: [...expiries]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([expiry, activity]) => ({ expiry, ...finish(activity) })),
    byStrike: [...strikes]
      .sort(([a], [b]) => a - b)
      .map(([strike, activity]) => ({ strike, ...finish(activity) })),
    cells: [...cells.values()]
      .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike)
      .map(({ expiry, strike, activity }) => ({ expiry, strike, ...finish(activity) })),
  };
}
