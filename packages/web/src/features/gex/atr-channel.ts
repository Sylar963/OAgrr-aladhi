export interface ChannelCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AtrChannelPoint {
  time: number;
  basis: number | null;
  atr: number | null;
  upper: number | null;
  lower: number | null;
}

export function atrChannel(
  candles: readonly ChannelCandle[],
  length: number,
  multiplier: number,
  resolutionSec: number,
): AtrChannelPoint[] {
  if (!Number.isInteger(length) || length < 2 || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('Invalid channel parameters');
  }
  let basis: number | null = null;
  let atr: number | null = null;
  let sumClose = 0;
  let sumRange = 0;
  let count = 0;
  let previous: ChannelCandle | null = null;
  return candles.map((c) => {
    if (previous && c.time - previous.time !== resolutionSec) {
      basis = null;
      atr = null;
      sumClose = 0;
      sumRange = 0;
      count = 0;
      previous = null;
    }
    // Freeze each bar's boundaries from the previous close so live wicks cannot move them.
    const point: AtrChannelPoint = {
      time: c.time,
      basis,
      atr,
      upper: basis == null || atr == null ? null : basis + multiplier * atr,
      lower: basis == null || atr == null ? null : basis - multiplier * atr,
    };
    const previousClose = previous?.close ?? c.open;
    const range = Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose));
    if (count < length) {
      sumClose += c.close;
      sumRange += range;
      count++;
      if (count === length) {
        basis = sumClose / length;
        atr = sumRange / length;
      }
    } else if (basis != null && atr != null) {
      basis += 2 / (length + 1) * (c.close - basis);
      atr += (range - atr) / length;
    }
    previous = c;
    return point;
  });
}
