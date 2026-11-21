import { describe, expect, it } from 'vitest';
import type { NewsDeliveryEvent } from '@oggregator/protocol';
import { reportedMacroHeadline } from './macro-figures.js';
function event(text: string): NewsDeliveryEvent {
  return {
    cursor: 'abc:1',
    sequence: 1,
    receivedAt: 2,
    firstReceivedAt: 2,
    revision: 1,
    backfill: false,
    observation: {
      id: 'a',
      text,
      timestamp: 1,
      source: 'wire',
      url: 'https://example.com',
      handle: null,
      ruleTag: null,
      classification: 'GOOD',
      upstreamCreatedAt: null,
    },
  };
}
describe('explicit macro figures already reported in headlines', () => {
  it('extracts labeled actual, consensus and previous with exact source spans', () => {
    const result = reportedMacroHeadline(
      event('US CPI YOY ACTUAL 2.5% (CONSENSUS 2.4%, PREVIOUS 2.3%)'),
    )!;
    expect(result.actual).toMatchObject({ value: 2.5, unit: '%', evidence: 'ACTUAL 2.5%' });
    expect(result.forecast?.value).toBe(2.4);
    expect(result.previous?.value).toBe(2.3);
    for (const figure of result.figures)
      expect(result.text.slice(figure.start, figure.end)).toBe(figure.evidence);
    expect(result).toMatchObject({
      sourceVerified: false,
      scheduledAt: null,
      provenance: 'headline-text',
    });
  });
  it('supports number-before-label, signed values and thousand separators', () => {
    const result = reportedMacroHeadline(event('US GDP -0.3% ACTUAL, 0.2% EXPECTED; PRIOR -0.1%'))!;
    expect(result.actual?.value).toBe(-0.3);
    expect(result.forecast?.value).toBe(0.2);
    expect(
      reportedMacroHeadline(event('US JOBLESS CLAIMS ACTUAL 220,000 PREVIOUS 218K'))?.actual?.value,
    ).toBe(220000);
  });
  it('does not invent missing consensus, publication schedules, units or revisions', () => {
    const result = reportedMacroHeadline(event('PMI ACTUAL 49.2'))!;
    expect(result.actual?.unit).toBeNull();
    expect(result.forecast).toBeNull();
    expect(result.revised).toBeNull();
    expect(reportedMacroHeadline(event('Fed discusses its 2027 GDP forecast'))?.figures).toEqual(
      [],
    );
    expect(reportedMacroHeadline(event('GDP forecast 2027 is uncertain'))?.figures).toEqual([]);
    expect(reportedMacroHeadline(event('CPI ACTUAL 2,5%'))?.figures).toEqual([]);
    expect(reportedMacroHeadline(event('Bitcoin price rallies'))).toBeNull();
  });
});
