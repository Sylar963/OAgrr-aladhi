import type { NewsDeliveryEvent, ReportedMacroHeadline } from '@oggregator/protocol';
const EVENT =
  /\b(CPI|PPI|PCE|GDP|NFP|NON[- ]?FARM PAYROLLS|PAYROLLS|UNEMPLOYMENT(?: RATE)?|(?:INITIAL )?JOBLESS CLAIMS|FOMC|PMI|RETAIL SALES|INTEREST RATE|FED(?:ERAL RESERVE)?)\b/i;
const LABEL = '(actual|forecast|consensus|expected|previous|prior|revised(?:\\s+to)?)';
const NUMBER = '([+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)';
const UNIT = '(\\s*(?:%|bps?|[KMB]\\b))?';
function role(label: string): 'actual' | 'forecast' | 'previous' | 'revised' {
  const value = label.toLowerCase();
  return value === 'actual'
    ? 'actual'
    : ['previous', 'prior'].includes(value)
      ? 'previous'
      : value.startsWith('revised')
        ? 'revised'
        : 'forecast';
}
export function reportedMacroHeadline(event: NewsDeliveryEvent): ReportedMacroHeadline | null {
  const item = event.observation;
  const eventName = item.text.match(EVENT)?.[0];
  if (!eventName) return null;
  const figures: ReportedMacroHeadline['figures'] = [];
  const patterns = [
    new RegExp('\\b' + LABEL + '\\s*[:=]?\\s*' + NUMBER + UNIT + '(?![\\d.]|,\\d)', 'gi'),
    new RegExp('(?<![\\d.,])' + NUMBER + UNIT + '\\s*' + LABEL + '\\b', 'gi'),
  ];
  for (const [index, pattern] of patterns.entries())
    for (const match of item.text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (figures.some((figure) => figure.start < end && figure.end > start)) continue;
      const label = match[index === 0 ? 1 : 3]!;
      const value = Number(match[index === 0 ? 2 : 1]!.replaceAll(',', ''));
      const unit = match[index === 0 ? 3 : 2]?.trim().toUpperCase() || null;
      if (
        !Number.isFinite(value) ||
        (unit == null && Number.isInteger(value) && value >= 1900 && value <= 2200)
      )
        continue;
      figures.push({ role: role(label), value, unit, evidence: match[0], start, end });
    }
  figures.sort((a, b) => a.start - b.start);
  const first = (wanted: 'actual' | 'forecast' | 'previous' | 'revised') =>
    figures.find((figure) => figure.role === wanted) ?? null;
  const country =
    item.text
      .match(/^(?:BREAKING[: -]+)?(US|U\.S\.|UK|EUROZONE|CANADA|JAPAN|CHINA)\b/i)?.[1]
      ?.toUpperCase() ?? null;
  return {
    eventId: item.id,
    cursor: event.cursor,
    revision: event.revision,
    eventName: eventName.toUpperCase(),
    country,
    source: item.source,
    url: item.url,
    text: item.text,
    publishedAt: item.timestamp,
    receivedAt: event.receivedAt,
    scheduledAt: null,
    actual: first('actual'),
    forecast: first('forecast'),
    previous: first('previous'),
    revised: first('revised'),
    figures,
    sourceVerified: false,
    provenance: 'headline-text',
    extractionVersion: 'macro-literals-v1',
  };
}
