import { useMemo } from 'react';

import { VENUES } from '@lib/venue-meta';
import { fmtUsd } from '@lib/format';
import { defineMessages, useT, type Translate } from '@lib/i18n';
import type { HistoryRange, HistorySummary } from './queries';
import DateRangePicker from './DateRangePicker';
import styles from './HistoryControls.module.css';

const messages = defineMessages(
  {
    notice: 'Experimental history. Counts and venue coverage are not guaranteed yet.',
    trades: 'Trades',
    premium: 'Premium',
    notional: 'Notional',
    window: 'Window',
    prev: 'Prev',
    next: 'Next',
    page: 'Page {page}',
    today: 'Today',
    yesterday: 'Yesterday',
    last7d: '7D',
    last30d: '30D',
    custom: 'Custom',
    noData: 'No data',
  },
  {
    notice: 'Historial experimental. Los conteos y la cobertura de exchanges aún no están garantizados.',
    trades: 'Trades',
    premium: 'Prima',
    notional: 'Nocional',
    window: 'Período',
    prev: 'Ant.',
    next: 'Sig.',
    page: 'Página {page}',
    today: 'Hoy',
    yesterday: 'Ayer',
    last7d: '7D',
    last30d: '30D',
    custom: 'Personalizado',
    noData: 'Sin datos',
  },
);

export type HistoryPreset = 'today' | 'yesterday' | 'last7d' | 'last30d' | 'custom';

interface HistoryControlsProps {
  preset: HistoryPreset;
  range: HistoryRange;
  summary: HistorySummary | undefined;
  bounds: HistorySummary | undefined;
  activeVenues: string[];
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  isPageLoading: boolean;
  isSummaryLoading: boolean;
  onPresetChange: (preset: HistoryPreset) => void;
  onRangeChange: (range: HistoryRange) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export function HistoryControls({
  preset,
  range,
  summary,
  bounds,
  activeVenues,
  page,
  hasPreviousPage,
  hasNextPage,
  isPageLoading,
  isSummaryLoading,
  onPresetChange,
  onRangeChange,
  onPreviousPage,
  onNextPage,
}: HistoryControlsProps) {
  const t = useT(messages);
  const venueSummary = useMemo(() => {
    if (!summary) return [];
    return summary.venues.filter((venue) => activeVenues.includes(venue.venue));
  }, [activeVenues, summary]);

  return (
    <div className={styles.wrap}>
      <div className={styles.notice} role="note">
        <span className={styles.noticeDot} />
        <span className={styles.noticeText}>
          {t('notice')}
        </span>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.presetRow}>
            {(['today', 'yesterday', 'last7d', 'last30d', 'custom'] as const).map((value) => (
              <button
                key={value}
                className={styles.presetBtn}
                data-active={preset === value}
                onClick={() => onPresetChange(value)}
              >
                {t(value)}
              </button>
            ))}
          </div>
        </div>

        {preset === 'custom' ? (
          <DateRangePicker range={range} bounds={bounds} onApply={onRangeChange} />
        ) : null}
      </div>

      <div className={styles.summaryGrid}>
        <SummaryCard
          label={t('trades')}
          value={isSummaryLoading ? '…' : formatCount(summary?.count ?? 0)}
        />
        <SummaryCard
          label={t('premium')}
          value={isSummaryLoading ? '…' : formatMoney(summary?.premiumUsd ?? 0)}
        />
        <SummaryCard
          label={t('notional')}
          value={isSummaryLoading ? '…' : formatMoney(summary?.notionalUsd ?? 0)}
        />
        <SummaryCard label={t('window')} value={formatWindowLabel(summary, range, t)} />
      </div>

      <div className={styles.metaRow}>
        <div className={styles.venueRow}>
          {venueSummary.map((venue) => {
            const meta = VENUES[venue.venue];
            return (
              <span key={venue.venue} className={styles.venueChip}>
                {meta?.logo ? <img src={meta.logo} alt="" className={styles.venueLogo} /> : null}
                <span className={styles.venueCode}>
                  {meta?.shortLabel ?? venue.venue.toUpperCase()}
                </span>
                <span className={styles.venueCount}>{formatCount(venue.count)}</span>
              </span>
            );
          })}
        </div>

        <div className={styles.pageControls}>
          <button
            className={styles.pageBtn}
            onClick={onPreviousPage}
            disabled={!hasPreviousPage || isPageLoading}
          >
            {t('prev')}
          </button>
          <span className={styles.pageLabel}>{t('page', { page })}</span>
          <button
            className={styles.pageBtn}
            onClick={onNextPage}
            disabled={!hasNextPage || isPageLoading}
          >
            {t('next')}
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryCard}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

function formatMoney(value: number): string {
  return value > 0 ? fmtUsd(value) : '—';
}

function formatWindowLabel(
  summary: HistorySummary | undefined,
  range: HistoryRange,
  t: Translate<typeof messages.en>,
): string {
  if (summary?.oldestTs && summary?.newestTs) {
    return `${formatIsoLabel(summary.oldestTs)} → ${formatIsoLabel(summary.newestTs)}`;
  }
  if (range.start && range.end) {
    return `${formatIsoLabel(range.start)} → ${formatIsoLabel(new Date(new Date(range.end).getTime() - 1).toISOString())}`;
  }
  return t('noData');
}

function formatIsoLabel(value: string): string {
  const date = new Date(value);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

export function getPresetRange(preset: HistoryPreset, now = new Date()): HistoryRange {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (preset === 'today') {
    return { start: todayStart.toISOString(), end: now.toISOString() };
  }

  if (preset === 'yesterday') {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    return { start: yesterdayStart.toISOString(), end: todayStart.toISOString() };
  }

  if (preset === 'last7d') {
    const start = new Date(todayStart);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  if (preset === 'last30d') {
    const start = new Date(todayStart);
    start.setUTCDate(start.getUTCDate() - 29);
    return { start: start.toISOString(), end: now.toISOString() };
  }

  return { start: null, end: null };
}
