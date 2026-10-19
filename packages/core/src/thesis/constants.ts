// Initial values, not validated. Recorded gate outcomes are what they get tuned from.
export const THESIS_BIAS_THRESHOLD = 0.25;
export const THESIS_MIN_BAND_PCT = 0.015;
export const THESIS_MIN_PNL_USD = 1;
export const THESIS_AT_RISK_FLOOR_PCT = 0.01;
export const THESIS_AT_RISK_MOVE_FRACTION = 0.5;
export const THESIS_WAIT_MS = 24 * 60 * 60 * 1000;
export const THESIS_REVERSAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const THESIS_GATE_SHOWN_DEDUPE_MS = 6 * 60 * 60 * 1000;

export const THESIS_DIFF_THRESHOLDS = {
  dvol: 0.05,
  atmIv: 0.05,
  skew25d: 0.03,
} as const;
