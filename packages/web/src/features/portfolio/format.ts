// Signed USD/number formatters for the portfolio totals row. Tiered precision so
// sub-$1 underlyings (e.g. $LIT, $WFLI) don't collapse small dollar greeks to "$0.00".
export function fmtUsdSigned(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '-';
  const abs = Math.abs(value);
  if (abs >= 100) return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs === 0) return '+$0.00';
  return `${sign}$${abs.toFixed(6)}`;
}

// Sign comes from value.toFixed() here (not Math.abs), so negatives keep their own
// minus — the leading '+' is only added for positives.
export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}`;
}
