import { Fragment, useMemo, useState, type DragEvent } from 'react';

import type { EnrichedStrike } from '@shared/enriched';
import { fmtUsd } from '@lib/format';
import { bestBidAsk } from '../quote-selection';
import { EASY_OPTION_MIME, encodeDraft, type EasyLegDraft } from './easy-explain';
import styles from './EasyChain.module.css';

interface EasyOptionListProps {
  type: 'call' | 'put';
  underlying: string;
  strikes: EnrichedStrike[];
  indexPrice: number | null;
  activeSet: ReadonlySet<string>;
  heldKeys: ReadonlySet<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAdd: (draft: EasyLegDraft) => void;
}

const WINDOW_EACH_SIDE = 7;

export function draftKey(d: EasyLegDraft): string {
  return `${d.strike}:${d.type}:${d.direction}`;
}

export default function EasyOptionList({
  type,
  underlying,
  strikes,
  indexPrice,
  activeSet,
  heldKeys,
  collapsed,
  onToggleCollapsed,
  onAdd,
}: EasyOptionListProps) {
  const [showAll, setShowAll] = useState(false);
  const isUp = type === 'call';

  const rows = useMemo(() => {
    const now = Date.now();
    const quoted = strikes
      .map((s) => {
        const side = type === 'call' ? s.call : s.put;
        const bba = bestBidAsk(side, activeSet, now);
        const ref = side.bestVenue != null ? side.venues[side.bestVenue] : undefined;
        return {
          strike: s.strike,
          buy: bba.ask,
          sell: bba.bid,
          odds: ref?.delta != null ? Math.abs(ref.delta) : null,
        };
      })
      .filter((r) => r.buy != null || r.sell != null);

    if (showAll || indexPrice == null || quoted.length === 0) return quoted;
    let atm = 0;
    for (let i = 1; i < quoted.length; i++) {
      if (Math.abs(quoted[i]!.strike - indexPrice) < Math.abs(quoted[atm]!.strike - indexPrice)) {
        atm = i;
      }
    }
    return quoted.slice(Math.max(0, atm - WINDOW_EACH_SIDE), atm + WINDOW_EACH_SIDE + 1);
  }, [strikes, type, activeSet, showAll, indexPrice]);

  // Highest price on top so the list reads in the same direction as the chart's price axis.
  const ordered = useMemo(() => [...rows].sort((a, b) => b.strike - a.strike), [rows]);
  const spotSlot = indexPrice == null ? -1 : ordered.findIndex((r) => r.strike < indexPrice);

  function startDrag(e: DragEvent, draft: EasyLegDraft) {
    e.dataTransfer.setData(EASY_OPTION_MIME, encodeDraft(draft));
    e.dataTransfer.setData('text/plain', `${draft.direction} ${draft.strike} ${draft.type}`);
    e.dataTransfer.effectAllowed = 'copy';
  }

  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.listCollapsed}
        data-side={isUp ? 'up' : 'down'}
        onClick={onToggleCollapsed}
        title={`Show ${isUp ? 'UP' : 'DOWN'} options`}
      >
        <span>{isUp ? '▲ UP options' : '▼ DOWN options'}</span>
      </button>
    );
  }

  return (
    <section className={styles.list} data-side={isUp ? 'up' : 'down'}>
      <header className={styles.listHeader}>
        <div>
          <div className={styles.listTitle}>
            {isUp ? '▲' : '▼'} Bet {underlying} goes {isUp ? 'UP' : 'DOWN'}
          </div>
          <div className={styles.listSub}>
            {isUp ? 'Calls' : 'Puts'}: pays you if the price ends {isUp ? 'above' : 'below'} the
            target
          </div>
        </div>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapsed}
          aria-label="Collapse list"
          title="Collapse"
        >
          {isUp ? '‹' : '›'}
        </button>
      </header>

      <div className={styles.listBody}>
        <div className={styles.listCols}>
          <span>Target</span>
          <span title="Market-implied chance this option ends in the money (from delta)">Odds</span>
          <span>Cost</span>
        </div>
        {ordered.map((r, i) => {
          const buyDraft: EasyLegDraft = { type, direction: 'buy', strike: r.strike };
          const sellDraft: EasyLegDraft = { type, direction: 'sell', strike: r.strike };
          const dist = indexPrice ? ((r.strike - indexPrice) / indexPrice) * 100 : null;
          const held = heldKeys.has(draftKey(buyDraft)) || heldKeys.has(draftKey(sellDraft));
          return (
            <Fragment key={r.strike}>
              {i === spotSlot && indexPrice != null && (
                <div className={styles.spotRow}>
                  {underlying} now {fmtUsd(indexPrice)}
                </div>
              )}
              <div
                className={styles.optRow}
                data-held={held}
                draggable={r.buy != null}
                onDragStart={(e) => startDrag(e, buyDraft)}
                title={`Drag onto the chart to buy. Pays if ${underlying} ends ${isUp ? 'above' : 'below'} ${fmtUsd(r.strike)}.`}
              >
                <span className={styles.grip} aria-hidden>
                  ⠿
                </span>
                <span className={styles.optStrike}>
                  {fmtUsd(r.strike)}
                  {dist != null && (
                    <small>
                      {dist >= 0 ? '+' : ''}
                      {dist.toFixed(1)}%
                    </small>
                  )}
                </span>
                <span className={styles.optOdds}>
                  {r.odds != null ? `${Math.round(r.odds * 100)}%` : '–'}
                </span>
                <span className={styles.optActions}>
                  <button
                    type="button"
                    className={styles.buyBtn}
                    disabled={r.buy == null}
                    onClick={() => onAdd(buyDraft)}
                    title="Buy: pay this premium, risk is limited to it"
                  >
                    {fmtUsd(r.buy)}
                  </button>
                  <button
                    type="button"
                    className={styles.sellBtn}
                    disabled={r.sell == null}
                    draggable={r.sell != null}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      startDrag(e, sellDraft);
                    }}
                    onClick={() => onAdd(sellDraft)}
                    title={`Sell: collect ${fmtUsd(r.sell)} now, but you take the risk`}
                  >
                    sell
                  </button>
                </span>
              </div>
            </Fragment>
          );
        })}
        {spotSlot === -1 && indexPrice != null && ordered.length > 0 && (
          <div className={styles.spotRow}>
            {underlying} now {fmtUsd(indexPrice)}
          </div>
        )}
      </div>

      <button type="button" className={styles.moreBtn} onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'Show fewer targets ▴' : 'Show all targets ▾'}
      </button>
    </section>
  );
}
