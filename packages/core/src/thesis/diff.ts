import type {
  ThesisDiff,
  ThesisDiffKey,
  ThesisDiffRow,
  ThesisMarketContext,
  ThesisStatus,
} from '@oggregator/protocol';

import { THESIS_DIFF_THRESHOLDS } from './constants.js';

function signFlipped(then: number, now: number): boolean {
  return then !== 0 && now !== 0 && Math.sign(then) !== Math.sign(now);
}

function row(
  key: ThesisDiffKey,
  then: number | null,
  now: number | null,
  material: (then: number, now: number) => boolean,
): ThesisDiffRow {
  return { key, then, now, material: then == null || now == null ? null : material(then, now) };
}

/** What changed since the thesis was written. A material row is a change, not a reason to flip. */
export function contextDiff(
  then: ThesisMarketContext,
  now: ThesisMarketContext,
  status: ThesisStatus,
): ThesisDiff {
  const rows = [
    row('spot', then.spotUsd, now.spotUsd, () => status === 'AT_RISK'),
    row('dvol', then.dvol, now.dvol, (a, b) => Math.abs(b - a) >= THESIS_DIFF_THRESHOLDS.dvol),
    row('atmIv', then.atmIv, now.atmIv, (a, b) => Math.abs(b - a) >= THESIS_DIFF_THRESHOLDS.atmIv),
    row(
      'skew25d',
      then.skew25d,
      now.skew25d,
      (a, b) => signFlipped(a, b) || Math.abs(b - a) >= THESIS_DIFF_THRESHOLDS.skew25d,
    ),
    row('netGex', then.netGexUsdMillions, now.netGexUsdMillions, signFlipped),
  ];
  return {
    rows,
    materialCount: rows.filter((r) => r.material === true).length,
    comparedCount: rows.filter((r) => r.material != null).length,
  };
}
