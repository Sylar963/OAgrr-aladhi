import type { BlockStrikeBucket } from '@shared/common';

import type { HeatSide, OiMode } from './oi-heatmap-utils';

export interface BlockBubble {
  timeSec: number;
  strike: number;
  callValue: number;
  putValue: number;
  value: number;
  dominant: 'call' | 'put';
  legs: number;
}

export function selectBlockBubbles(
  buckets: readonly BlockStrikeBucket[],
  opts: { mode: OiMode; side: HeatSide; hiddenExpiries: ReadonlySet<string> },
): BlockBubble[] {
  const merged = new Map<string, BlockBubble>();
  for (const b of buckets) {
    if (b.expiry != null && opts.hiddenExpiries.has(b.expiry)) continue;
    const call = opts.side === 'puts' ? 0 : opts.mode === 'notional' ? b.callNotionalUsd : b.callContracts;
    const put = opts.side === 'calls' ? 0 : opts.mode === 'notional' ? b.putNotionalUsd : b.putContracts;
    if (!(call + put > 0)) continue;

    const key = `${b.ts}|${b.strike}`;
    const existing = merged.get(key);
    if (existing) {
      existing.callValue += call;
      existing.putValue += put;
      existing.legs += b.legs;
    } else {
      merged.set(key, {
        timeSec: b.ts,
        strike: b.strike,
        callValue: call,
        putValue: put,
        value: 0,
        dominant: 'call',
        legs: b.legs,
      });
    }
  }

  const bubbles = [...merged.values()];
  for (const bubble of bubbles) {
    bubble.value = bubble.callValue + bubble.putValue;
    bubble.dominant = bubble.callValue >= bubble.putValue ? 'call' : 'put';
  }
  return bubbles.sort((a, b) => a.value - b.value);
}
