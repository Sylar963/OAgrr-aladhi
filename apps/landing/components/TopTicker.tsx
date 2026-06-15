'use client';

import { useReducedMotion } from 'framer-motion';
import { useState } from 'react';

type SpotQuote = { priceLabel: string; changeLabel: string };
export type TickerSpots = Partial<Record<'BTC' | 'ETH', SpotQuote>>;

type TapeItem = { label: string; value: string };

// Live spot rows only render when real snapshot data exists — never a fake price.
function buildTapeItems(spots: TickerSpots | undefined): TapeItem[] {
  const items: TapeItem[] = [
    {
      label: 'Venues',
      value: 'Deribit · OKX · Binance · Bybit · Thalex · Derive · Coincall · Gate.io',
    },
  ];

  if (spots?.BTC) {
    items.push({ label: 'Spot', value: `BTC ${spots.BTC.priceLabel} ${spots.BTC.changeLabel}` });
  }
  if (spots?.ETH) {
    items.push({ label: 'Spot', value: `ETH ${spots.ETH.priceLabel} ${spots.ETH.changeLabel}` });
  }

  items.push({
    label: 'Coverage',
    value: 'Options chains · vol surfaces · flow tape · routing',
  });

  return items;
}

function TapeRun({ items, hidden }: { items: TapeItem[]; hidden?: boolean }) {
  return (
    <div aria-hidden={hidden} className="flex min-w-max items-center gap-2">
      {items.map((item) => (
        <div
          key={item.value}
          className="flex items-center gap-2 rounded-full border border-white/8 bg-[#0f1216] px-3 py-1.5"
        >
          <span className="text-zinc-500">{item.label}</span>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TopTicker({ spots }: { spots?: TickerSpots }) {
  const items = buildTapeItems(spots);
  const [paused, setPaused] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="overflow-hidden border-b border-[color:var(--landing-border)] bg-[rgba(10,10,10,0.92)] backdrop-blur-xl">
      <div className="landing-container flex items-center gap-3 px-4 py-2 sm:px-6">
        <div className="landing-feed-tape min-w-0 flex-1 overflow-hidden">
          <div
            className="landing-feed-tape-track flex min-w-max items-center gap-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-300"
            style={{ animationPlayState: paused ? 'paused' : 'running' }}
          >
            <TapeRun items={items} />
            <TapeRun items={items} hidden />
          </div>
        </div>
        {prefersReducedMotion ? null : (
          <button
            type="button"
            aria-label="Pause ticker"
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
            className="shrink-0 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-400 transition hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--landing-accent)]"
          >
            <span aria-hidden>{paused ? '▶' : '⏸'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
