import { useEffect, useMemo, useRef, useState } from 'react';

import { Spinner } from '@components/ui';

import {
  categoryLabel,
  clockTime,
  dayKey,
  dayLabel,
  splitHeadline,
  timeAgo,
} from './news-format';
import { type ArchivedNewsItem, NEWS_WINDOWS, type NewsWindow, useNewsArchive } from './queries';
import styles from './NewsView.module.css';

type Layout = 'grid' | 'list';

const LAYOUT_KEY = 'ogg:news-layout';
const FRESH_MS = 15 * 60_000;
const NOW_TICK_MS = 30_000;

function readLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    // Private mode / blocked storage: the toggle still works for this session.
  }
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.2 10.8 15.8 6.2M8.2 13.2l7.6 4.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      {[3, 13].flatMap((x) =>
        [3, 13].map((y) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="8"
            height="8"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        )),
      )}
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ShareButton({ item }: { item: ArchivedNewsItem }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function share() {
    const title = splitHeadline(item.text).title;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url: item.url });
        return;
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
    } catch {
      window.open(item.url, '_blank', 'noopener');
    }
  }

  return (
    <button
      type="button"
      className={styles.shareBtn}
      onClick={() => void share()}
      aria-label={copied ? 'Link copied' : 'Share headline'}
      title={copied ? 'Link copied' : 'Share'}
    >
      {copied ? <span className={styles.copied}>Copied</span> : <ShareIcon />}
    </button>
  );
}

function SourceBadge({ item }: { item: ArchivedNewsItem }) {
  const name = item.handle ?? item.source;
  return (
    <span className={styles.source}>
      <span className={styles.avatar} aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      {item.handle ? `@${item.handle}` : item.source}
    </span>
  );
}

function NewsCard({ item, now }: { item: ArchivedNewsItem; now: number }) {
  const { title, summary } = splitHeadline(item.text);
  const fresh = now - item.timestamp < FRESH_MS;

  return (
    <article className={styles.card} data-fresh={fresh}>
      <div className={styles.cardTop}>
        <span className={styles.tag}>{categoryLabel(item.ruleTag)}</span>
        {fresh && <span className={styles.freshPill}>NEW</span>}
      </div>
      <a className={styles.headline} href={item.url} target="_blank" rel="noopener noreferrer">
        {title}
      </a>
      {summary && <p className={styles.summary}>{summary}</p>}
      <footer className={styles.cardFoot}>
        <div className={styles.metaCol}>
          <SourceBadge item={item} />
          <time
            className={styles.time}
            dateTime={new Date(item.timestamp).toISOString()}
            title={new Date(item.timestamp).toLocaleString()}
          >
            <ClockIcon />
            {timeAgo(item.timestamp, now)}
          </time>
        </div>
        <ShareButton item={item} />
      </footer>
    </article>
  );
}

function NewsRow({ item, now }: { item: ArchivedNewsItem; now: number }) {
  const { title, summary } = splitHeadline(item.text);
  return (
    <li className={styles.row} data-fresh={now - item.timestamp < FRESH_MS}>
      <time
        className={styles.rowTime}
        dateTime={new Date(item.timestamp).toISOString()}
        title={timeAgo(item.timestamp, now)}
      >
        {clockTime(item.timestamp)}
      </time>
      <span className={styles.rowTag}>{categoryLabel(item.ruleTag)}</span>
      <div className={styles.rowBody}>
        <a className={styles.rowTitle} href={item.url} target="_blank" rel="noopener noreferrer">
          {title}
        </a>
        {summary && <span className={styles.rowSummary}>{summary}</span>}
      </div>
      <SourceBadge item={item} />
      <ShareButton item={item} />
    </li>
  );
}

function NewsList({ items, now }: { items: ArchivedNewsItem[]; now: number }) {
  const groups = useMemo(() => {
    const out: { key: number; items: ArchivedNewsItem[] }[] = [];
    for (const item of items) {
      const key = dayKey(item.timestamp);
      const last = out.at(-1);
      if (last && last.key === key) last.items.push(item);
      else out.push({ key, items: [item] });
    }
    return out;
  }, [items]);

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className={styles.dayHeader}>{dayLabel(group.key, now)}</h3>
          <ul className={styles.rows}>
            {group.items.map((item) => (
              <NewsRow key={item.id} item={item} now={now} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function NewsView() {
  const [range, setRange] = useState<NewsWindow>('latest');
  const [layout, setLayout] = useState<Layout>(readLayout);
  const now = useNow(NOW_TICK_MS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useNewsArchive(range);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: ArchivedNewsItem[] = [];
    for (const page of data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }, [data]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { root, rootMargin: '600px 0px' },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  function selectWindow(next: NewsWindow) {
    setRange(next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function selectLayout(next: Layout) {
    setLayout(next);
    writeLayout(next);
  }

  return (
    <div className={styles.view}>
      <header className={styles.toolbar}>
        <div className={styles.windows} role="tablist" aria-label="Time window">
          {NEWS_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={range === w.id}
              className={styles.windowBtn}
              data-active={range === w.id}
              onClick={() => selectWindow(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className={styles.status}>
          <span className={styles.liveDot} aria-hidden="true" />
          {items.length > 0
            ? `${items.length}${hasNextPage ? '+' : ''} headlines`
            : 'Live headline archive'}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.topBtn}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            TOP <span aria-hidden="true">⤒</span>
          </button>
          <div className={styles.layoutToggle} role="group" aria-label="Layout">
            <button
              type="button"
              className={styles.layoutBtn}
              data-active={layout === 'grid'}
              aria-pressed={layout === 'grid'}
              aria-label="Card grid"
              onClick={() => selectLayout('grid')}
            >
              <GridIcon />
            </button>
            <button
              type="button"
              className={styles.layoutBtn}
              data-active={layout === 'list'}
              aria-pressed={layout === 'list'}
              aria-label="List"
              onClick={() => selectLayout('list')}
            >
              <ListIcon />
            </button>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className={styles.scroll}>
        {isPending ? (
          <div className={styles.center}>
            <Spinner size="lg" label="Loading headlines…" />
          </div>
        ) : error && items.length === 0 ? (
          <div className={styles.center}>Couldn’t load headlines. Retrying…</div>
        ) : items.length === 0 ? (
          <div className={styles.center}>No headlines recorded in this window yet.</div>
        ) : layout === 'grid' ? (
          <div className={styles.grid}>
            {items.map((item) => (
              <NewsCard key={item.id} item={item} now={now} />
            ))}
          </div>
        ) : (
          <NewsList items={items} now={now} />
        )}

        <div ref={sentinelRef} className={styles.footer}>
          {isFetchingNextPage && <Spinner size="sm" />}
          {hasNextPage && !isFetchingNextPage && (
            <button type="button" className={styles.moreBtn} onClick={() => void fetchNextPage()}>
              Load more
            </button>
          )}
          {!hasNextPage && items.length > 0 && (
            <span className={styles.end}>End of archive for this window</span>
          )}
        </div>
      </div>
    </div>
  );
}
