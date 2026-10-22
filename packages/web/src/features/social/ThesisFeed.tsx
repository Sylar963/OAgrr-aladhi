import { EmptyState, Spinner } from '@components/ui';
import {
  fmtAge,
  fmtDuration,
  fmtExpiry,
  fmtPrice,
  shareThesis,
  STATUS_LABEL,
  useTheses,
  useThesisRefresh,
  wrongIfText,
} from '@features/thesis';
import type { PublicThesisDto, ThesisState, ThesisView } from '@oggregator/protocol';
import { useMemo, useState } from 'react';

import { useLeaderboard, useThesisFeed, useThesisFeedRefresh } from './hooks/queries';
import styles from './ThesisFeed.module.css';

type Scope = 'all' | 'active' | 'mine';

const SCOPES: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'mine', label: 'Mine' },
];

const REASON_CLAMP_CHARS = 220;

const ENDED_LABEL: Record<Exclude<ThesisState, 'active'>, { label: string; title: string }> = {
  invalidated: { label: 'Invalidated', title: 'A confirmation candle closed beyond the level' },
  expired: { label: 'Held to horizon', title: 'The horizon passed without the level breaking' },
  ended_early: { label: 'Ended early', title: 'The author ended it before the horizon' },
  overridden: { label: 'Flipped', title: 'The author flipped to the other side before a wait finished' },
  reversed: { label: 'Flipped', title: 'The author flipped to the other side after waiting' },
};

function outcome(thesis: PublicThesisDto): { label: string; title?: string; tone: string } {
  if (thesis.state === 'active') {
    const status = thesis.status ?? 'INTACT';
    return { label: STATUS_LABEL[status], tone: status };
  }
  return { ...ENDED_LABEL[thesis.state], tone: thesis.state };
}

function spotMove(thesis: PublicThesisDto): { pct: number; favorable: boolean } | null {
  if (thesis.spotAtCreation == null || thesis.spotUsd == null || thesis.spotAtCreation <= 0) return null;
  const pct = thesis.spotUsd / thesis.spotAtCreation - 1;
  return { pct, favorable: thesis.direction === 'bearish' ? pct < 0 : pct > 0 };
}

function horizonProgress(thesis: PublicThesisDto, nowMs: number): number {
  const horizonMs = Date.parse(`${thesis.horizonExpiry}T08:00:00Z`);
  const span = horizonMs - thesis.createdAt;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, ((thesis.endedAt ?? nowMs) - thesis.createdAt) / span));
}

interface ThesisFeedProps {
  selectedHandle: string | null;
  onSelectTrader: (handle: string) => void;
}

export default function ThesisFeed({ selectedHandle, onSelectTrader }: ThesisFeedProps) {
  const feed = useThesisFeed();
  const ranked = useLeaderboard('all');
  const [scope, setScope] = useState<Scope>('all');
  const [underlying, setUnderlying] = useState<string | null>(null);
  const [unfocusedFrom, setUnfocusedFrom] = useState<string | null>(null);
  const focus = selectedHandle != null && unfocusedFrom !== selectedHandle ? selectedHandle : null;

  const rankedHandles = useMemo(
    () => new Set((ranked.data?.entries ?? []).map((entry) => entry.handle.toLowerCase())),
    [ranked.data],
  );
  const theses = feed.data?.theses ?? [];
  const underlyings = useMemo(() => [...new Set(theses.map((t) => t.underlying))].sort(), [theses]);
  const visible = theses.filter(
    (thesis) =>
      (scope === 'all' || (scope === 'active' ? thesis.state === 'active' : thesis.isMe)) &&
      (underlying == null || thesis.underlying === underlying) &&
      (focus == null || thesis.handle.toLowerCase() === focus.toLowerCase()),
  );
  const nowMs = Date.now();

  return (
    <section className={styles.feed} aria-label="Theses">
      <header className={styles.header}>
        <h2 className={styles.title}>Theses</h2>
        <div className={styles.filters} role="tablist" aria-label="Show">
          {SCOPES.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={option.id === scope}
              className={styles.filterBtn}
              data-active={option.id === scope}
              onClick={() => setScope(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {underlyings.length > 1 && (
          <div className={styles.filters} aria-label="Underlying">
            {underlyings.map((name) => (
              <button
                key={name}
                aria-pressed={underlying === name}
                className={styles.filterBtn}
                data-active={underlying === name}
                onClick={() => setUnderlying(underlying === name ? null : name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {focus && (
          <button
            className={styles.focusChip}
            onClick={() => setUnfocusedFrom(focus)}
            title="Show every trader's theses"
          >
            @{focus} <span aria-hidden>×</span>
          </button>
        )}
      </header>

      <div className={styles.list}>
        <MyPrivateTheses />
        {feed.isLoading ? (
          <Spinner size="md" label="Loading theses…" />
        ) : feed.isError ? (
          <EmptyState title="Theses unavailable" detail="Try again in a moment." />
        ) : visible.length === 0 ? (
          <EmptyState
            title={theses.length === 0 ? 'No shared theses yet' : 'Nothing matches'}
            detail={
              theses.length === 0
                ? 'Write a thesis in Architect and share it, or share an active one above.'
                : focus
                  ? `@${focus} has not shared a thesis in the last 30 days.`
                  : 'Try another filter.'
            }
          />
        ) : (
          visible.map((thesis) => (
            <ThesisCard
              key={thesis.id}
              thesis={thesis}
              nowMs={nowMs}
              onSelectTrader={rankedHandles.has(thesis.handle.toLowerCase()) ? onSelectTrader : null}
            />
          ))
        )}
      </div>
    </section>
  );
}

function useShareAction() {
  const refreshTheses = useThesisRefresh();
  const refreshFeed = useThesisFeedRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, shared: boolean) {
    setBusy(id);
    setError(null);
    try {
      await shareThesis(id, shared);
      await Promise.all([refreshTheses(), refreshFeed()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, run };
}

function MyPrivateTheses() {
  const own = useTheses();
  const share = useShareAction();
  const unshared = (own.data?.active ?? []).filter((view: ThesisView) => view.thesis.share == null);
  if (unshared.length === 0) return null;

  return (
    <div className={styles.prompt}>
      {unshared.map(({ thesis }) => (
        <div key={thesis.id} className={styles.promptRow}>
          <span className={styles.promptText}>
            Your <strong>{thesis.underlying}</strong>{' '}
            <span className={styles.direction} data-direction={thesis.direction}>
              {thesis.direction}
            </span>{' '}
            thesis until {fmtExpiry(thesis.horizonExpiry)} is private.
          </span>
          <button
            className={styles.shareBtn}
            disabled={share.busy != null}
            onClick={() => void share.run(thesis.id, true)}
          >
            {share.busy === thesis.id ? 'Sharing…' : 'Share'}
          </button>
        </div>
      ))}
      {share.error && <p className={styles.error}>{share.error}</p>}
    </div>
  );
}

interface ThesisCardProps {
  thesis: PublicThesisDto;
  nowMs: number;
  onSelectTrader: ((handle: string) => void) | null;
}

function ThesisCard({ thesis, nowMs, onSelectTrader }: ThesisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const share = useShareAction();
  const result = outcome(thesis);
  const move = spotMove(thesis);
  const active = thesis.state === 'active';
  const long = thesis.reason.length > REASON_CLAMP_CHARS;
  const horizonMs = Date.parse(`${thesis.horizonExpiry}T08:00:00Z`);

  return (
    <article className={styles.card} data-mine={thesis.isMe} data-active={active}>
      <div className={styles.cardHead}>
        {onSelectTrader ? (
          <button
            className={styles.handleBtn}
            onClick={() => onSelectTrader(thesis.handle)}
            title="Open their book"
          >
            @{thesis.handle}
          </button>
        ) : (
          <span className={styles.handle}>@{thesis.handle}</span>
        )}
        {thesis.isMe && <span className={styles.youTag}>you</span>}
        <time className={styles.age} dateTime={new Date(thesis.createdAt).toISOString()}>
          {fmtAge(thesis.createdAt, nowMs)}
        </time>
        <span className={styles.outcome} data-tone={result.tone} title={result.title}>
          {result.label}
        </span>
      </div>

      <div className={styles.call}>
        <span className={styles.underlying}>{thesis.underlying}</span>
        <span className={styles.direction} data-direction={thesis.direction}>
          {thesis.direction === 'bearish' ? '▼ Bearish' : '▲ Bullish'}
        </span>
        <span className={styles.until}>until {fmtExpiry(thesis.horizonExpiry)}</span>
      </div>

      <p className={styles.reason} data-clamped={long && !expanded}>
        {thesis.reason}
      </p>
      {long && (
        <button className={styles.moreBtn} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Less' : 'More'}
        </button>
      )}

      <p className={styles.rule}>
        Wrong if {wrongIfText(thesis.direction, thesis.level, thesis.confirmSec)}
      </p>

      <div className={styles.metrics}>
        <span>
          Spot {fmtPrice(thesis.spotAtCreation)} → {fmtPrice(thesis.spotUsd)}
          {move && (
            <span className={styles.move} data-favorable={move.favorable}>
              {' '}
              {move.pct >= 0 ? '+' : '−'}
              {Math.abs(move.pct * 100).toFixed(1)}%
            </span>
          )}
        </span>
        {active && thesis.roomPct != null && <span>{(thesis.roomPct * 100).toFixed(1)}% room</span>}
        <span>
          {active
            ? `${fmtDuration(Math.max(0, horizonMs - nowMs))} left`
            : thesis.endedAt != null
              ? `ended ${fmtAge(thesis.endedAt, nowMs)}`
              : 'ended'}
        </span>
      </div>
      <div
        className={styles.progress}
        role="presentation"
        title={`${Math.round(horizonProgress(thesis, nowMs) * 100)}% of the horizon elapsed`}
      >
        <span
          className={styles.progressFill}
          data-tone={result.tone}
          style={{ width: `${horizonProgress(thesis, nowMs) * 100}%` }}
        />
      </div>

      {!active && thesis.endNote && <p className={styles.endNote}>“{thesis.endNote}”</p>}

      {thesis.isMe && (
        <div className={styles.cardFoot}>
          {share.error && <span className={styles.error}>{share.error}</span>}
          <button
            className={styles.withdrawBtn}
            disabled={share.busy != null}
            onClick={() => void share.run(thesis.id, false)}
          >
            {share.busy ? 'Withdrawing…' : 'Withdraw from feed'}
          </button>
        </div>
      )}
    </article>
  );
}
