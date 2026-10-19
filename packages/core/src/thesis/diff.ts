import type {
  ThesisDiff,
  ThesisDiffKey,
  ThesisDiffRow,
  ThesisMarketContext,
  ThesisStatus,
} from '@oggregator/protocol';

import { THESIS_DIFF_THRESHOLDS } from './constants.js';

function signFlipped(before: number, after: number): boolean {
  return before !== 0 && after !== 0 && Math.sign(before) !== Math.sign(after);
}

function row(
  key: ThesisDiffKey,
  before: number | null,
  after: number | null,
  material: (before: number, after: number) => boolean,
): ThesisDiffRow {
  return {
    key,
    before,
    after,
    material: before == null || after == null ? null : material(before, after),
  };
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
