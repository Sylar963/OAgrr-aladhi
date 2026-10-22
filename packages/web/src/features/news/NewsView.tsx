import { useEffect, useMemo, useRef, useState } from 'react';

import { Spinner } from '@components/ui';
import { defineMessages, type Translate, useLocale, useT } from '@lib/i18n';

import type { NewsPin } from '@oggregator/protocol';

import {
  categoryLabel,
  clockTime,
  dayKey,
  dayLabel,
  headlineLabel,
  splitHeadline,
  timeAgo,
} from './news-format';
import {
  type ArchivedNewsItem,
  NEWS_WINDOWS,
  type NewsWindow,
  useNewsArchive,
  useNewsPins,
  usePinMutation,
} from './queries';
import styles from './NewsView.module.css';

const messages = defineMessages(
  {
    unpinHeadline: 'Unpin headline',
    unpinOneFirst: 'Unpin one first (max 3)',
    pinHeadline: 'Pin headline',
    relevance: 'Relevance {score}/100',
    pinned: 'pinned',
    relatedToPin: 'related to a pin',
    alreadyKnown: 'already known',
    markerPinned: 'PINNED',
    markerKnown: 'KNOWN',
    markerPinStory: 'PIN STORY',
    linkCopied: 'Link copied',
    shareHeadline: 'Share headline',
    share: 'Share',
    copied: 'Copied',
    fresh: 'NEW',
    pinnedHint:
      'Pin up to 3 headlines that define the moment. Related news is lifted, and retellings fade as the story ages.',
    pinnedHeadlines: 'Pinned headlines',
    unpin: 'Unpin',
    timeWindow: 'Time window',
    latest: 'Latest',
    headlinesCount: '{n} headlines',
    liveArchive: 'Live headline archive',
    top: 'TOP',
    layout: 'Layout',
    cardGrid: 'Card grid',
    list: 'List',
    loading: 'Loading headlines…',
    loadError: 'Couldn’t load headlines. Retrying…',
    empty: 'No headlines recorded in this window yet.',
    loadMore: 'Load more',
    end: 'End of archive for this window',
  },
  {
    unpinHeadline: 'Desfijar titular',
    unpinOneFirst: 'Desfija uno primero (máx. 3)',
    pinHeadline: 'Fijar titular',
    relevance: 'Relevancia {score}/100',
    pinned: 'fijado',
    relatedToPin: 'relacionado con un fijado',
    alreadyKnown: 'ya conocido',
    markerPinned: 'FIJADO',
    markerKnown: 'CONOCIDO',
    markerPinStory: 'HISTORIA FIJADA',
    linkCopied: 'Enlace copiado',
    shareHeadline: 'Compartir titular',
    share: 'Compartir',
    copied: 'Copiado',
    fresh: 'NUEVO',
    pinnedHint:
      'Fija hasta 3 titulares que definan el momento. Las noticias relacionadas se destacan y las repeticiones se atenúan a medida que la historia envejece.',
    pinnedHeadlines: 'Titulares fijados',
    unpin: 'Desfijar',
    timeWindow: 'Ventana de tiempo',
    latest: 'Recientes',
    headlinesCount: '{n} titulares',
    liveArchive: 'Archivo de titulares en vivo',
    top: 'ARRIBA',
    layout: 'Diseño',
    cardGrid: 'Cuadrícula de tarjetas',
    list: 'Lista',
    loading: 'Cargando titulares…',
    loadError: 'No se pudieron cargar los titulares. Reintentando…',
    empty: 'Aún no hay titulares registrados en esta ventana.',
    loadMore: 'Cargar más',
    end: 'Fin del archivo para esta ventana',
  },
);

type T = Translate<typeof messages.en>;

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

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M9 3h6l-1 6 4 4H6l4-4-1-6ZM12 13v8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PinControl {
  canEdit: boolean;
  full: boolean;
  pinnedIds: ReadonlySet<string>;
  busy: boolean;
  toggle: (id: string, pinned: boolean) => void;
}

function PinButton({ item, pins }: { item: ArchivedNewsItem; pins: PinControl }) {
  const t = useT(messages);
  const pinned = pins.pinnedIds.has(item.id);
  if (!pins.canEdit) return null;
  const blocked = !pinned && pins.full;
  const label = pinned ? t('unpinHeadline') : blocked ? t('unpinOneFirst') : t('pinHeadline');
  return (
    <button
      type="button"
      className={styles.pinBtn}
      data-active={pinned}
      disabled={pins.busy || blocked}
      onClick={() => pins.toggle(item.id, pinned)}
      aria-pressed={pinned}
      aria-label={label}
      title={label}
    >
      <PinIcon />
    </button>
  );
}

function relevanceTitle(item: ArchivedNewsItem, t: T): string | undefined {
  const r = item.relevance;
  if (!r) return undefined;
  const parts = [t('relevance', { score: r.score })];
  if (r.tags.length > 0) parts.push(r.tags.map((tag) => categoryLabel(tag)).join(', '));
  if (r.pinId) parts.push(r.pinId === item.id ? t('pinned') : t('relatedToPin'));
  if (r.repeat) parts.push(t('alreadyKnown'));
  return parts.join(' · ');
}

function RelevanceMarker({ item }: { item: ArchivedNewsItem }) {
  const t = useT(messages);
  const r = item.relevance;
  if (!r) return null;
  if (r.pinId === item.id) return <span className={styles.marker}>{t('markerPinned')}</span>;
  if (r.repeat) return <span className={styles.marker}>{t('markerKnown')}</span>;
  if (r.pinId) return <span className={styles.marker}>{t('markerPinStory')}</span>;
  return null;
}

function ShareButton({ item }: { item: ArchivedNewsItem }) {
  const tr = useT(messages);
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
      aria-label={copied ? tr('linkCopied') : tr('shareHeadline')}
      title={copied ? tr('linkCopied') : tr('share')}
    >
      {copied ? <span className={styles.copied}>{tr('copied')}</span> : <ShareIcon />}
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

function NewsCard({ item, now, pins }: { item: ArchivedNewsItem; now: number; pins: PinControl }) {
  const t = useT(messages);
  const locale = useLocale();
  const { title, summary } = splitHeadline(item.text);
  const fresh = now - item.timestamp < FRESH_MS;

  return (
    <article
      className={styles.card}
      data-fresh={fresh}
      data-tier={item.relevance?.tier ?? 'normal'}
      data-repeat={item.relevance?.repeat ?? false}
    >
      <div className={styles.cardTop}>
        <span className={styles.tag} title={relevanceTitle(item, t)}>
          {headlineLabel(item)}
        </span>
        <span className={styles.cardMarkers}>
          <RelevanceMarker item={item} />
          {fresh && <span className={styles.freshPill}>{t('fresh')}</span>}
        </span>
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
            {timeAgo(item.timestamp, now, locale)}
          </time>
        </div>
        <div className={styles.actionsCell}>
          <PinButton item={item} pins={pins} />
          <ShareButton item={item} />
        </div>
      </footer>
    </article>
  );
}

function NewsRow({ item, now, pins }: { item: ArchivedNewsItem; now: number; pins: PinControl }) {
  const t = useT(messages);
  const locale = useLocale();
  const { title, summary } = splitHeadline(item.text);
  return (
    <li
      className={styles.row}
      data-fresh={now - item.timestamp < FRESH_MS}
      data-tier={item.relevance?.tier ?? 'normal'}
      data-repeat={item.relevance?.repeat ?? false}
    >
      <time
        className={styles.rowTime}
        dateTime={new Date(item.timestamp).toISOString()}
        title={timeAgo(item.timestamp, now, locale)}
      >
        {clockTime(item.timestamp)}
      </time>
      <span className={styles.rowTag} title={relevanceTitle(item, t)}>
        {headlineLabel(item)}
        <RelevanceMarker item={item} />
      </span>
      <div className={styles.rowBody}>
        <a className={styles.rowTitle} href={item.url} target="_blank" rel="noopener noreferrer">
          {title}
        </a>
        {summary && <span className={styles.rowSummary}>{summary}</span>}
      </div>
      <SourceBadge item={item} />
      <div className={styles.actionsCell}>
        <PinButton item={item} pins={pins} />
        <ShareButton item={item} />
      </div>
    </li>
  );
}

function NewsList({
  items,
  now,
  pins,
}: {
  items: ArchivedNewsItem[];
  now: number;
  pins: PinControl;
}) {
  const locale = useLocale();
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
          <h3 className={styles.dayHeader}>{dayLabel(group.key, now, locale)}</h3>
          <ul className={styles.rows} data-editable={pins.canEdit}>
            {group.items.map((item) => (
              <NewsRow key={item.id} item={item} now={now} pins={pins} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PinnedBar({ pins, control, now }: { pins: NewsPin[]; control: PinControl; now: number }) {
  const t = useT(messages);
  const locale = useLocale();
  if (pins.length === 0) {
    return control.canEdit ? (
      <div className={styles.pinnedHint}>
        <PinIcon />
        {t('pinnedHint')}
      </div>
    ) : null;
  }
  return (
    <ul className={styles.pinnedBar} aria-label={t('pinnedHeadlines')}>
      {pins.map((pin) => (
        <li key={pin.id} className={styles.pinnedItem}>
          <PinIcon />
          <a
            className={styles.pinnedTitle}
            href={pin.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {splitHeadline(pin.text).title}
          </a>
          <span className={styles.pinnedMeta}>
            {pin.handle ? `@${pin.handle} · ` : ''}
            {timeAgo(pin.timestamp, now, locale)}
          </span>
          {control.canEdit && (
            <button
              type="button"
              className={styles.unpinBtn}
              disabled={control.busy}
              onClick={() => control.toggle(pin.id, true)}
              aria-label={t('unpinHeadline')}
              title={t('unpin')}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function NewsView() {
  const t = useT(messages);
  const [range, setRange] = useState<NewsWindow>('latest');
  const [layout, setLayout] = useState<Layout>(readLayout);
  const now = useNow(NOW_TICK_MS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data, error, isPending, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useNewsArchive(range);
  const { data: pinData } = useNewsPins();
  const pinMutation = usePinMutation();

  const pins = pinData?.pins ?? [];
  const pinControl = useMemo<PinControl>(
    () => ({
      canEdit: pinData?.canEdit ?? false,
      full: (pinData?.pins.length ?? 0) >= (pinData?.max ?? 3),
      pinnedIds: new Set(pinData?.pins.map((p) => p.id)),
      busy: pinMutation.isPending,
      toggle: (id, pinned) => pinMutation.mutate({ id, pinned }),
    }),
    [pinData, pinMutation.isPending, pinMutation.mutate],
  );

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
        <div className={styles.windows} role="tablist" aria-label={t('timeWindow')}>
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
              {w.id === 'latest' ? t('latest') : w.label}
            </button>
          ))}
        </div>

        <div className={styles.status}>
          <span className={styles.liveDot} aria-hidden="true" />
          {items.length > 0
            ? t('headlinesCount', { n: `${items.length}${hasNextPage ? '+' : ''}` })
            : t('liveArchive')}
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.topBtn}
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            {t('top')} <span aria-hidden="true">⤒</span>
          </button>
          <div className={styles.layoutToggle} role="group" aria-label={t('layout')}>
            <button
              type="button"
              className={styles.layoutBtn}
              data-active={layout === 'grid'}
              aria-pressed={layout === 'grid'}
              aria-label={t('cardGrid')}
              onClick={() => selectLayout('grid')}
            >
              <GridIcon />
            </button>
            <button
              type="button"
              className={styles.layoutBtn}
              data-active={layout === 'list'}
              aria-pressed={layout === 'list'}
              aria-label={t('list')}
              onClick={() => selectLayout('list')}
            >
              <ListIcon />
            </button>
          </div>
        </div>
      </header>

      <PinnedBar pins={pins} control={pinControl} now={now} />
      {pinMutation.error && (
        <div className={styles.pinError} role="alert">
          {pinMutation.error.message}
        </div>
      )}

      <div ref={scrollRef} className={styles.scroll}>
        {isPending ? (
          <div className={styles.center}>
            <Spinner size="lg" label={t('loading')} />
          </div>
        ) : error && items.length === 0 ? (
          <div className={styles.center}>{t('loadError')}</div>
        ) : items.length === 0 ? (
          <div className={styles.center}>{t('empty')}</div>
        ) : layout === 'grid' ? (
          <div className={styles.grid}>
            {items.map((item) => (
              <NewsCard key={item.id} item={item} now={now} pins={pinControl} />
            ))}
          </div>
        ) : (
          <NewsList items={items} now={now} pins={pinControl} />
        )}

        <div ref={sentinelRef} className={styles.footer}>
          {isFetchingNextPage && <Spinner size="sm" />}
          {hasNextPage && !isFetchingNextPage && (
            <button type="button" className={styles.moreBtn} onClick={() => void fetchNextPage()}>
              {t('loadMore')}
            </button>
          )}
          {!hasNextPage && items.length > 0 && (
            <span className={styles.end}>{t('end')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
