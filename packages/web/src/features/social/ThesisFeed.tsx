import { EmptyState, Spinner } from "@components/ui";
import {
  fmtDuration,
  fmtExpiry,
  fmtPrice,
  shareThesis,
  useTheses,
  useThesisRefresh,
} from "@features/thesis";
import { defineMessages, type Translate, useLocale, useT } from "@lib/i18n";
import type {
  PublicThesisDto,
  ThesisState,
  ThesisView,
} from "@oggregator/protocol";
import { Fragment, type ReactNode, useMemo, useState } from "react";

import {
  useLeaderboard,
  useThesisFeed,
  useThesisFeedRefresh,
} from "./hooks/queries";
import { socialMessages } from "./i18n";
import styles from "./ThesisFeed.module.css";

const messages = defineMessages(
  {
    scopeAll: "All",
    scopeActive: "Active",
    scopeMine: "Mine",
    statusINTACT: "Intact",
    statusAT_RISK: "At risk",
    statusINVALIDATED: "Invalidated",
    statusEXPIRED: "Expired",
    invalidated: "Invalidated",
    invalidatedTitle: "A confirmation candle closed beyond the level",
    expired: "Held to horizon",
    expiredTitle: "The horizon passed without the level breaking",
    ended_early: "Ended early",
    ended_earlyTitle: "The author ended it before the horizon",
    overridden: "Flipped",
    overriddenTitle: "The author flipped to the other side before a wait finished",
    reversed: "Flipped",
    reversedTitle: "The author flipped to the other side after waiting",
    ageDays_one: "{n} day ago",
    ageDays_other: "{n} days ago",
    ageShort: "{d} ago",
    theses: "Theses",
    show: "Show",
    underlying: "Underlying",
    showEveryone: "Show every trader's theses",
    loading: "Loading theses…",
    unavailable: "Theses unavailable",
    emptyTitle: "No shared theses yet",
    noMatchTitle: "Nothing matches",
    emptyDetail:
      "Write a thesis in Architect and share it, or share an active one above.",
    focusDetail: "@{handle} has not shared a thesis in the last 30 days.",
    noMatchDetail: "Try another filter.",
    privatePrompt: "Your {underlying} {direction} thesis until {date} is private.",
    bearish: "bearish",
    bullish: "bullish",
    bearishCall: "▼ Bearish",
    bullishCall: "▲ Bullish",
    sharing: "Sharing…",
    share: "Share",
    openBook: "Open their book",
    until: "until {date}",
    less: "Less",
    more: "More",
    wrongIfAbove: "Wrong if a {tf} candle closes above {level}",
    wrongIfBelow: "Wrong if a {tf} candle closes below {level}",
    room: "{pct}% room",
    left: "{d} left",
    endedAgo: "ended {age}",
    ended: "ended",
    elapsed: "{pct}% of the horizon elapsed",
    withdrawing: "Withdrawing…",
    withdraw: "Withdraw from feed",
  },
  {
    scopeAll: "Todas",
    scopeActive: "Activas",
    scopeMine: "Mías",
    statusINTACT: "Intacta",
    statusAT_RISK: "En riesgo",
    statusINVALIDATED: "Invalidada",
    statusEXPIRED: "Vencida",
    invalidated: "Invalidada",
    invalidatedTitle: "Una vela de confirmación cerró más allá del nivel",
    expired: "Sostenida al horizonte",
    expiredTitle: "El horizonte pasó sin que se rompiera el nivel",
    ended_early: "Terminada antes",
    ended_earlyTitle: "El autor la terminó antes del horizonte",
    overridden: "Invertida",
    overriddenTitle: "El autor se pasó al otro lado antes de terminar la espera",
    reversed: "Invertida",
    reversedTitle: "El autor se pasó al otro lado después de esperar",
    ageDays_one: "hace {n} día",
    ageDays_other: "hace {n} días",
    ageShort: "hace {d}",
    theses: "Tesis",
    show: "Mostrar",
    underlying: "Subyacente",
    showEveryone: "Ver las tesis de todos los traders",
    loading: "Cargando tesis…",
    unavailable: "Tesis no disponibles",
    emptyTitle: "Aún no hay tesis compartidas",
    noMatchTitle: "Sin resultados",
    emptyDetail:
      "Escribe una tesis en Architect y compártela, o comparte una activa arriba.",
    focusDetail: "@{handle} no ha compartido tesis en los últimos 30 días.",
    noMatchDetail: "Prueba otro filtro.",
    privatePrompt: "Tu tesis {direction} de {underlying} hasta {date} es privada.",
    bearish: "bajista",
    bullish: "alcista",
    bearishCall: "▼ Bajista",
    bullishCall: "▲ Alcista",
    sharing: "Compartiendo…",
    share: "Compartir",
    openBook: "Ver su libro",
    until: "hasta {date}",
    less: "Menos",
    more: "Más",
    wrongIfAbove: "Inválida si una vela {tf} cierra por encima de {level}",
    wrongIfBelow: "Inválida si una vela {tf} cierra por debajo de {level}",
    room: "{pct}% de margen",
    left: "quedan {d}",
    endedAgo: "terminó {age}",
    ended: "terminada",
    elapsed: "{pct}% del horizonte transcurrido",
    withdrawing: "Retirando…",
    withdraw: "Retirar del feed",
  },
);

type T = Translate<typeof messages.en>;

type Scope = "all" | "active" | "mine";

const SCOPES: ReadonlyArray<{ id: Scope; label: keyof typeof messages.en }> = [
  { id: "all", label: "scopeAll" },
  { id: "active", label: "scopeActive" },
  { id: "mine", label: "scopeMine" },
];

const REASON_CLAMP_CHARS = 220;

function outcome(
  thesis: PublicThesisDto,
  t: T,
): {
  label: string;
  title?: string;
  tone: string;
} {
  if (thesis.state === "active") {
    const status = thesis.status ?? "INTACT";
    return { label: t(`status${status}`), tone: status };
  }
  const state: Exclude<ThesisState, "active"> = thesis.state;
  return {
    label: t(state),
    title: t(`${state}Title`),
    tone: state,
  };
}

function fmtAge(createdAt: number, nowMs: number, t: T): string {
  const days = Math.floor((nowMs - createdAt) / 86_400_000);
  if (days >= 1)
    return t(days === 1 ? "ageDays_one" : "ageDays_other", { n: days });
  return t("ageShort", { d: fmtDuration(nowMs - createdAt) });
}

function wrongIfText(thesis: PublicThesisDto, t: T): string {
  return t(thesis.direction === "bearish" ? "wrongIfAbove" : "wrongIfBelow", {
    tf: thesis.confirmSec === 86400 ? "1D" : "4H",
    level: fmtPrice(thesis.level),
  });
}

function fillTemplate(
  template: string,
  slots: Record<string, ReactNode>,
): ReactNode[] {
  return template
    .split(/\{(\w+)\}/)
    .map((part, i) =>
      i % 2 === 1 ? (
        <Fragment key={i}>{slots[part]}</Fragment>
      ) : (
        part
      ),
    );
}

function spotMove(
  thesis: PublicThesisDto,
): { pct: number; favorable: boolean } | null {
  if (
    thesis.spotAtCreation == null ||
    thesis.spotUsd == null ||
    thesis.spotAtCreation <= 0
  )
    return null;
  const pct = thesis.spotUsd / thesis.spotAtCreation - 1;
  return { pct, favorable: thesis.direction === "bearish" ? pct < 0 : pct > 0 };
}

function horizonProgress(thesis: PublicThesisDto, nowMs: number): number {
  const horizonMs = Date.parse(`${thesis.horizonExpiry}T08:00:00Z`);
  const span = horizonMs - thesis.createdAt;
  if (!(span > 0)) return 1;
  return Math.min(
    1,
    Math.max(0, ((thesis.endedAt ?? nowMs) - thesis.createdAt) / span),
  );
}

interface ThesisFeedProps {
  selectedHandle: string | null;
  onSelectTrader: (handle: string) => void;
}

export default function ThesisFeed({
  selectedHandle,
  onSelectTrader,
}: ThesisFeedProps) {
  const t = useT(messages);
  const ts = useT(socialMessages);
  const feed = useThesisFeed();
  const ranked = useLeaderboard("all");
  const [scope, setScope] = useState<Scope>("all");
  const [underlying, setUnderlying] = useState<string | null>(null);
  const [unfocusedFrom, setUnfocusedFrom] = useState<string | null>(null);
  const focus =
    selectedHandle != null && unfocusedFrom !== selectedHandle
      ? selectedHandle
      : null;

  const rankedHandles = useMemo(
    () =>
      new Set(
        (ranked.data?.entries ?? []).map((entry) => entry.handle.toLowerCase()),
      ),
    [ranked.data],
  );
  const theses = feed.data?.theses ?? [];
  const underlyings = useMemo(
    () => [...new Set(theses.map((t) => t.underlying))].sort(),
    [theses],
  );
  const visible = theses.filter(
    (thesis) =>
      (scope === "all" ||
        (scope === "active" ? thesis.state === "active" : thesis.isMe)) &&
      (underlying == null || thesis.underlying === underlying) &&
      (focus == null || thesis.handle.toLowerCase() === focus.toLowerCase()),
  );
  const nowMs = Date.now();

  return (
    <section className={styles.feed} aria-label={t("theses")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("theses")}</h2>
        <div className={styles.filters} role="tablist" aria-label={t("show")}>
          {SCOPES.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={option.id === scope}
              className={styles.filterBtn}
              data-active={option.id === scope}
              onClick={() => setScope(option.id)}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
        {underlyings.length > 1 && (
          <div className={styles.filters} aria-label={t("underlying")}>
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
            title={t("showEveryone")}
          >
            @{focus} <span aria-hidden>×</span>
          </button>
        )}
      </header>

      <div className={styles.list}>
        <MyPrivateTheses />
        {feed.isLoading ? (
          <Spinner size="md" label={t("loading")} />
        ) : feed.isError ? (
          <EmptyState title={t("unavailable")} detail={ts("tryAgain")} />
        ) : visible.length === 0 ? (
          <EmptyState
            title={
              theses.length === 0 ? t("emptyTitle") : t("noMatchTitle")
            }
            detail={
              theses.length === 0
                ? t("emptyDetail")
                : focus
                  ? t("focusDetail", { handle: focus })
                  : t("noMatchDetail")
            }
          />
        ) : (
          visible.map((thesis) => (
            <ThesisCard
              key={thesis.id}
              thesis={thesis}
              nowMs={nowMs}
              onSelectTrader={
                rankedHandles.has(thesis.handle.toLowerCase())
                  ? onSelectTrader
                  : null
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

function useShareAction() {
  const ts = useT(socialMessages);
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
      setError(err instanceof Error ? err.message : ts("requestFailed"));
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, run };
}

function MyPrivateTheses() {
  const t = useT(messages);
  const locale = useLocale();
  const own = useTheses();
  const share = useShareAction();
  const unshared = (own.data?.active ?? []).filter(
    (view: ThesisView) => view.thesis.share == null,
  );
  if (unshared.length === 0) return null;

  return (
    <div className={styles.prompt}>
      {unshared.map(({ thesis }) => (
        <div key={thesis.id} className={styles.promptRow}>
          <span className={styles.promptText}>
            {fillTemplate(t("privatePrompt"), {
              underlying: <strong>{thesis.underlying}</strong>,
              direction: (
                <span
                  className={styles.direction}
                  data-direction={thesis.direction}
                >
                  {t(thesis.direction)}
                </span>
              ),
              date: fmtExpiry(thesis.horizonExpiry, locale),
            })}
          </span>
          <button
            className={styles.shareBtn}
            disabled={share.busy != null}
            onClick={() => void share.run(thesis.id, true)}
          >
            {share.busy === thesis.id ? t("sharing") : t("share")}
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
  const t = useT(messages);
  const locale = useLocale();
  const ts = useT(socialMessages);
  const [expanded, setExpanded] = useState(false);
  const share = useShareAction();
  const result = outcome(thesis, t);
  const move = spotMove(thesis);
  const active = thesis.state === "active";
  const long = thesis.reason.length > REASON_CLAMP_CHARS;
  const horizonMs = Date.parse(`${thesis.horizonExpiry}T08:00:00Z`);

  return (
    <article
      className={styles.card}
      data-mine={thesis.isMe}
      data-active={active}
    >
      <div className={styles.cardHead}>
        {onSelectTrader ? (
          <button
            className={styles.handleBtn}
            onClick={() => onSelectTrader(thesis.handle)}
            title={t("openBook")}
          >
            @{thesis.handle}
          </button>
        ) : (
          <span className={styles.handle}>@{thesis.handle}</span>
        )}
        {thesis.isMe && <span className={styles.youTag}>{ts("you")}</span>}
        <time
          className={styles.age}
          dateTime={new Date(thesis.createdAt).toISOString()}
        >
          {fmtAge(thesis.createdAt, nowMs, t)}
        </time>
        <span
          className={styles.outcome}
          data-tone={result.tone}
          title={result.title}
        >
          {result.label}
        </span>
      </div>

      <div className={styles.call}>
        <span className={styles.underlying}>{thesis.underlying}</span>
        <span className={styles.direction} data-direction={thesis.direction}>
          {thesis.direction === "bearish" ? t("bearishCall") : t("bullishCall")}
        </span>
        <span className={styles.until}>
          {t("until", { date: fmtExpiry(thesis.horizonExpiry, locale) })}
        </span>
      </div>

      <p className={styles.reason} data-clamped={long && !expanded}>
        {thesis.reason}
      </p>
      {long && (
        <button
          className={styles.moreBtn}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? t("less") : t("more")}
        </button>
      )}

      <p className={styles.rule}>{wrongIfText(thesis, t)}</p>

      <div className={styles.metrics}>
        <span>
          Spot {fmtPrice(thesis.spotAtCreation)} → {fmtPrice(thesis.spotUsd)}
          {move && (
            <span className={styles.move} data-favorable={move.favorable}>
              {" "}
              {move.pct >= 0 ? "+" : "−"}
              {Math.abs(move.pct * 100).toFixed(1)}%
            </span>
          )}
        </span>
        {active && thesis.roomPct != null && (
          <span>{t("room", { pct: (thesis.roomPct * 100).toFixed(1) })}</span>
        )}
        <span>
          {active
            ? t("left", { d: fmtDuration(Math.max(0, horizonMs - nowMs)) })
            : thesis.endedAt != null
              ? t("endedAgo", { age: fmtAge(thesis.endedAt, nowMs, t) })
              : t("ended")}
        </span>
      </div>
      <div
        className={styles.progress}
        role="presentation"
        title={t("elapsed", {
          pct: Math.round(horizonProgress(thesis, nowMs) * 100),
        })}
      >
        <span
          className={styles.progressFill}
          data-tone={result.tone}
          style={{ width: `${horizonProgress(thesis, nowMs) * 100}%` }}
        />
      </div>

      {!active && thesis.endNote && (
        <p className={styles.endNote}>“{thesis.endNote}”</p>
      )}

      {thesis.isMe && (
        <div className={styles.cardFoot}>
          {share.error && <span className={styles.error}>{share.error}</span>}
          <button
            className={styles.withdrawBtn}
            disabled={share.busy != null}
            onClick={() => void share.run(thesis.id, false)}
          >
            {share.busy ? t("withdrawing") : t("withdraw")}
          </button>
        </div>
      )}
    </article>
  );
}
