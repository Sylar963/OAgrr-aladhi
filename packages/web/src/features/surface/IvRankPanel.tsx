import { useId, useState } from "react";

import type { TenorRichness } from "@oggregator/protocol";

import HoverTooltip from "@components/ui/HoverTooltip";
import { useVolRichness } from "@hooks/useVolRichness";
import { getTokenLogo } from "@lib/token-meta";
import { fmtIv } from "@lib/format";
import { fmtVolPts, fmtZ } from "@lib/vol-richness";
import type { IvHistoryTenorResult, IvTenor } from "@shared/enriched";
import { getHistoryCoverage, type HistoryCoverage } from "./history-coverage";
import { useIvHistory, type IvHistoryWindow } from "./queries";
import VolConeChart, { type ConeIvPoint } from "./VolConeChart";
import styles from "./IvRankPanel.module.css";

const TENORS: IvTenor[] = ["7d", "30d", "60d", "90d"];
const TENOR_DAYS: Record<IvTenor, number> = {
  "7d": 7,
  "30d": 30,
  "60d": 60,
  "90d": 90,
};
const SPARK_POINTS = 48;
const SPARK_W = 100;
const SPARK_H = 28;

function rankLevel(rank: number | null): "hot" | "mid" | "cold" | "none" {
  if (rank == null) return "none";
  if (rank >= 70) return "hot";
  if (rank <= 30) return "cold";
  return "mid";
}

function richnessLevel(
  state: TenorRichness["state"],
): "hot" | "mid" | "cold" | "none" {
  if (state === "rich") return "hot";
  if (state === "cheap") return "cold";
  if (state === "fair") return "mid";
  return "none";
}

function sparkPoints(
  values: Array<number | null>,
  width: number,
  height: number,
): Array<[number, number]> {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (xs.length < 2) return [];
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min;
  const step = width / (xs.length - 1);
  return xs.map((v, i) => [
    i * step,
    span > 0 ? height - ((v - min) / span) * height : height / 2,
  ]);
}

function sampleEvenly<T>(arr: T[], targetCount: number): T[] {
  if (arr.length <= targetCount) return arr;
  const step = arr.length / targetCount;
  const out: T[] = [];
  for (let i = 0; i < targetCount; i++) {
    out.push(arr[Math.floor(i * step)]!);
  }
  if (out[out.length - 1] !== arr[arr.length - 1]) {
    out[out.length - 1] = arr[arr.length - 1]!;
  }
  return out;
}

const IVR_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>How to read IV Rank</div>
    <div>
      Where current ATM IV sits within the look-back window (toggle above the
      chips).
    </div>
    <div className={styles.tipFormula}>
      rank = (current − min) / (max − min) × 100
    </div>
    <ul className={styles.tipList}>
      <li>
        <b style={{ color: "var(--color-profit)" }}>0–30</b>: IV cheap vs the
        window — vol buyers favored.
      </li>
      <li>
        <b style={{ color: "var(--color-warning)" }}>30–70</b>: mid-range; no
        strong edge.
      </li>
      <li>
        <b style={{ color: "var(--color-loss)" }}>70–100</b>: IV rich vs the
        window — vol sellers favored.
      </li>
    </ul>
    <div className={styles.tipBlock}>
      <b>Per-tenor source</b>
      <ul className={styles.tipList}>
        <li>
          <b>30d</b> (BTC/ETH): Deribit DVOL — ~1 year of daily closes, kept
          live by the DVOL push.
        </li>
        <li>
          <b>7d / 60d / 90d</b>: cross-venue ATM averages interpolated to the
          tenor, snapshotted every 5 min.
        </li>
        <li>
          After a fresh server start, 7d/60d/90d are thinly populated — check{" "}
          <b>n</b> on each chip.
        </li>
      </ul>
    </div>
  </div>
);

const RANK_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>IV Rank</div>
    <div>Position of current ATM IV in the window’s low→high band.</div>
    <div className={styles.tipFormula}>
      rank = (current − min) / (max − min) × 100
    </div>
    <ul className={styles.tipList}>
      <li>
        0 = at window low (cheapest seen). 100 = at window high (richest seen).
      </li>
      <li>
        <b style={{ color: "var(--color-loss)" }}>&gt;70</b>: premium rich
        historically — prefer selling vol.
      </li>
      <li>
        <b style={{ color: "var(--color-warning)" }}>30–70</b>: middle of the
        range; no strong edge.
      </li>
      <li>
        <b style={{ color: "var(--color-profit)" }}>&lt;30</b>: premium cheap
        historically — prefer buying vol.
      </li>
    </ul>
  </div>
);

const PCT_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>IV Percentile</div>
    <div>Share of historical samples ≤ current IV.</div>
    <ul className={styles.tipList}>
      <li>Robust to outliers — one extreme print does not move the needle.</li>
      <li>
        50% = half the history was lower. 90% = only 10% of the window has been
        richer.
      </li>
      <li>
        Pair with rank: a wide divergence flags outlier-distorted distributions.
      </li>
    </ul>
  </div>
);

const RICHNESS_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>IV vs forecast</div>
    <div>
      Rank and pct compare IV with its own past. This row compares it with what
      BTC is likely to realize over the same horizon.
    </div>
    <div className={styles.tipFormula}>
      excess = IV − forecast RV − usual (IV − later RV)
    </div>
    <ul className={styles.tipList}>
      <li>
        <b>fcst</b>: excess premium in vol points. Negative: cheap; positive:
        rich; ±2 pts fair (our band, untested on BTC).
      </li>
      <li>
        <b>hist</b>: z-score of IV − forecast against its own daily history
        (overlapping, so descriptive only).
      </li>
      <li>
        <b>24h</b>: z-score of IV against the last 24h of 5-minute samples.
        Shows whether vol was just bid or offered.
      </li>
      <li>
        7D and 30D only: the usual-premium baselines exist for those tenors.
      </li>
    </ul>
  </div>
);

const SAMPLES_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>Samples</div>
    <div>Valid ATM IV readings inside the selected window.</div>
    <ul className={styles.tipList}>
      <li>
        30d BTC/ETH seeds from ~1 year of Deribit DVOL daily candles on startup.
      </li>
      <li>
        Other tenors accumulate one new point every 5 min from the live surface.
      </li>
      <li>Rank / pct show “–” until n ≥ 2 with a non-zero range.</li>
    </ul>
  </div>
);

const STATE_LABEL: Record<TenorRichness["state"], string> = {
  cheap: "cheap",
  fair: "fair",
  rich: "rich",
  unavailable: "n/a",
};

function RichnessRow({ richness }: { richness: TenorRichness | null }) {
  if (!richness) {
    return (
      <div className={styles.richness} data-empty="true">
        no forecast baseline
      </div>
    );
  }
  const level = richnessLevel(richness.state);
  return (
    <HoverTooltip
      as="div"
      className={styles.richness}
      placement="bottom-start"
      content={RICHNESS_TIP}
    >
      <span className={styles.statePill} data-level={level}>
        {STATE_LABEL[richness.state]}
      </span>
      <span className={styles.rankValue} data-level={level}>
        {fmtVolPts(richness.excessPremium)}
      </span>
      <span className={styles.metaRight}>
        <span>hist {fmtZ(richness.excessHistory.zScore)}</span>
        <span>24h {fmtZ(richness.intraday.zScore24h)}</span>
      </span>
    </HoverTooltip>
  );
}

function RangeBar({
  rank,
  percentile,
  min,
  max,
}: {
  rank: number | null;
  percentile: number | null;
  min: number | null;
  max: number | null;
}) {
  return (
    <div className={styles.range}>
      <div className={styles.rangeTrack}>
        {percentile != null && (
          <span
            className={styles.rangePct}
            style={{ left: `${percentile}%` }}
          />
        )}
        {rank != null && (
          <span
            className={styles.rangeMarker}
            data-level={rankLevel(rank)}
            style={{ left: `${Math.min(Math.max(rank, 0), 100)}%` }}
          />
        )}
      </div>
      <div className={styles.rangeLabels}>
        <span>{fmtIv(min)}</span>
        <span>{fmtIv(max)}</span>
      </div>
    </div>
  );
}

function Chip({
  tenor,
  result,
  richness,
  showRichness,
}: {
  tenor: IvTenor;
  result: IvHistoryTenorResult | undefined;
  richness: TenorRichness | null;
  showRichness: boolean;
}) {
  const series = result?.series ?? [];
  const n = series.filter((p) => p.atmIv != null).length;
  const currentIv = result?.current.atmIv ?? null;
  const rank = result?.atmRank ?? null;
  const percentile = result?.atmPercentile ?? null;
  const level = rankLevel(rank);
  const points = sparkPoints(
    sampleEvenly(series, SPARK_POINTS).map((p) => p.atmIv),
    SPARK_W,
    SPARK_H,
  );
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join("");
  const last = points.at(-1);
  const gradientId = `ivr-spark-${tenor}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className={styles.chip} data-level={level}>
      <div className={styles.chipHead}>
        <div>
          <div className={styles.chipTenor}>{tenor.toUpperCase()} ATM</div>
          <div className={styles.chipIv}>{fmtIv(currentIv)}</div>
        </div>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-end"
          content={RANK_TIP}
        >
          <span className={styles.rankBlock} data-level={level}>
            <span className={styles.rankNum}>
              {rank != null ? rank.toFixed(0) : "–"}
            </span>
            <span className={styles.rankCaption}>rank</span>
          </span>
        </HoverTooltip>
      </div>

      <div className={styles.sparkWrap}>
        <svg
          className={styles.spark}
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {line && (
            <>
              <path
                d={`${line}L${SPARK_W},${SPARK_H}L0,${SPARK_H}Z`}
                fill={`url(#${gradientId})`}
              />
              <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {last && (
          <span
            className={styles.sparkDot}
            style={{ top: `${(last[1] / SPARK_H) * 100}%` }}
            aria-hidden
          />
        )}
      </div>

      <RangeBar
        rank={rank}
        percentile={percentile}
        min={result?.min.atmIv ?? null}
        max={result?.max.atmIv ?? null}
      />

      <div className={styles.chipMeta}>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-start"
          content={PCT_TIP}
        >
          pct{" "}
          <span className={styles.rankValue} data-level={level}>
            {percentile != null ? `${percentile.toFixed(0)}%` : "–"}
          </span>
        </HoverTooltip>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-end"
          content={SAMPLES_TIP}
        >
          n {n}
        </HoverTooltip>
      </div>

      {showRichness && <RichnessRow richness={richness} />}
    </div>
  );
}

const CONE_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>Vol cone</div>
    <div>
      Grey bands: distribution of realized vol over every rolling window of each
      horizon, from ~2 years of Deribit perpetual daily closes (Sinclair vol cone).
    </div>
    <ul className={styles.tipList}>
      <li>
        Darkest band 25–75th pct, then 10–90th, then min–max. Dashed line is the
        median.
      </li>
      <li>
        <b style={{ color: "var(--accent-primary)" }}>Teal</b>: current ATM IV
        term structure. Label is its percentile inside the cone (≈ when
        interpolated from the bands).
      </li>
      <li>
        <b style={{ color: "#f7a600" }}>Orange</b>: realized vol over the
        trailing window of each horizon.
      </li>
      <li>
        IV near the top of the cone prices more movement than BTC has usually
        delivered.
      </li>
    </ul>
  </div>
);

interface Props {
  underlying: string;
}

function shortestCoverage(
  results: Array<IvHistoryTenorResult | undefined>,
  window: IvHistoryWindow,
): HistoryCoverage {
  const coverages = results.map((result) =>
    getHistoryCoverage(result?.series ?? [], window, ["atmIv"]),
  );
  return coverages.reduce((min, item) =>
    item.coverageMs < min.coverageMs ? item : min,
  );
}

export default function IvRankPanel({ underlying }: Props) {
  const [window, setWindow] = useState<IvHistoryWindow>("30d");
  const { data } = useIvHistory(underlying, window);
  const { data: richness } = useVolRichness(underlying);
  const logo = getTokenLogo(underlying);
  const coneIvPoints: ConeIvPoint[] = TENORS.flatMap((t) => {
    const iv = data?.tenors[t]?.current.atmIv;
    if (iv == null) return [];
    const exact =
      t === "7d" || t === "30d" ? richness?.tenors[t].conePercentile : null;
    return [{ days: TENOR_DAYS[t], iv, exactPercentile: exact }];
  });
  const coverage = shortestCoverage(
    TENORS.map((t) => data?.tenors[t]),
    window,
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <HoverTooltip
          as="span"
          className={styles.title}
          placement="bottom-start"
          content={IVR_TIP}
        >
          <span className={styles.titleTrigger}>
            {logo && <img src={logo} alt="" className={styles.tokenLogo} />}
            {underlying} IV RANK
          </span>
        </HoverTooltip>
        <div className={styles.windowToggle}>
          <button
            type="button"
            className={styles.windowBtn}
            data-active={window === "30d" ? "true" : undefined}
            onClick={() => setWindow("30d")}
          >
            30d
          </button>
          <button
            type="button"
            className={styles.windowBtn}
            data-active={window === "90d" ? "true" : undefined}
            onClick={() => setWindow("90d")}
          >
            90d
          </button>
        </div>
      </div>
      <div
        className={styles.coverage}
        data-short={coverage.short ? "true" : undefined}
      >
        {coverage.label}
      </div>

      <div className={styles.grid}>
        {TENORS.map((t) => (
          <Chip
            key={t}
            tenor={t}
            result={data?.tenors[t]}
            richness={
              t === "7d" || t === "30d" ? (richness?.tenors[t] ?? null) : null
            }
            showRichness={richness != null}
          />
        ))}
      </div>

      <div className={styles.coneSection}>
        <div className={styles.coneHeader}>
          <HoverTooltip
            as="span"
            className={styles.coneTitle}
            placement="bottom-start"
            content={CONE_TIP}
          >
            <span className={styles.titleTrigger}>
              VOL CONE · IV vs realized
            </span>
          </HoverTooltip>
          <div className={styles.legend}>
            <span>
              <i className={styles.lgIv} />
              ATM IV
            </span>
            <span>
              <i className={styles.lgRv} />
              RV now
            </span>
            <span>
              <i className={styles.lgMedian} />
              median
            </span>
            <span>
              <i className={styles.lgBand} />
              25–75 / 10–90 / range
            </span>
          </div>
        </div>
        <VolConeChart bands={richness?.volCone ?? []} ivPoints={coneIvPoints} />
      </div>
    </div>
  );
}
