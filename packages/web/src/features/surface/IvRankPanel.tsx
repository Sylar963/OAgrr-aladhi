import { type ReactNode, useId, useState } from "react";

import type { TenorRichness } from "@oggregator/protocol";

import HoverTooltip from "@components/ui/HoverTooltip";
import { useVolRichness } from "@hooks/useVolRichness";
import { type Locale, useLocale, useT } from "@lib/i18n";
import { getTokenLogo } from "@lib/token-meta";
import { fmtIv } from "@lib/format";
import { fmtVolPts, fmtZ } from "@lib/vol-richness";
import type { IvHistoryTenorResult, IvTenor } from "@shared/enriched";
import { getHistoryCoverage, type HistoryCoverage } from "./history-coverage";
import { ivRankMessages } from "./i18n";
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

function IvrTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t("ivrTipTitle")}</div>
      <div>{t("ivrTipBody")}</div>
      <div className={styles.tipFormula}>
        rank = (current − min) / (max − min) × 100
      </div>
      <ul className={styles.tipList}>
        <li>
          <b style={{ color: "var(--color-profit)" }}>0–30</b>
          {t("ivrCheap")}
        </li>
        <li>
          <b style={{ color: "var(--color-warning)" }}>30–70</b>
          {t("ivrMid")}
        </li>
        <li>
          <b style={{ color: "var(--color-loss)" }}>70–100</b>
          {t("ivrRich")}
        </li>
      </ul>
      <div className={styles.tipBlock}>
        <b>{t("perTenorSource")}</b>
        <ul className={styles.tipList}>
          <li>
            <b>30d</b>
            {t("src30")}
          </li>
          <li>
            <b>7d / 60d / 90d</b>
            {t("srcOther")}
          </li>
          <li>
            {t("srcFreshA")}
            <b>n</b>
            {t("srcFreshB")}
          </li>
        </ul>
      </div>
    </div>
  );
}

function RankTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t("rankTipTitle")}</div>
      <div>{t("rankTipBody")}</div>
      <div className={styles.tipFormula}>
        rank = (current − min) / (max − min) × 100
      </div>
      <ul className={styles.tipList}>
        <li>{t("rankTip0")}</li>
        <li>
          <b style={{ color: "var(--color-loss)" }}>&gt;70</b>
          {t("rankTipRich")}
        </li>
        <li>
          <b style={{ color: "var(--color-warning)" }}>30–70</b>
          {t("rankTipMid")}
        </li>
        <li>
          <b style={{ color: "var(--color-profit)" }}>&lt;30</b>
          {t("rankTipCheap")}
        </li>
      </ul>
    </div>
  );
}

function PctTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t("pctTipTitle")}</div>
      <div>{t("pctTipBody")}</div>
      <ul className={styles.tipList}>
        <li>{t("pctTip1")}</li>
        <li>{t("pctTip2")}</li>
        <li>{t("pctTip3")}</li>
      </ul>
    </div>
  );
}

function RichnessTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t("richTipTitle")}</div>
      <div>{t("richTipBody")}</div>
      <div className={styles.tipFormula}>{t("richTipFormula")}</div>
      <ul className={styles.tipList}>
        <li>
          <b>fcst</b>
          {t("richFcst")}
        </li>
        <li>
          <b>hist</b>
          {t("richHist")}
        </li>
        <li>
          <b>24h</b>
          {t("rich24h")}
        </li>
        <li>{t("richTenors")}</li>
      </ul>
    </div>
  );
}

function SamplesTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t("samplesTitle")}</div>
      <div>{t("samplesBody")}</div>
      <ul className={styles.tipList}>
        <li>{t("samples1")}</li>
        <li>{t("samples2")}</li>
        <li>{t("samples3")}</li>
      </ul>
    </div>
  );
}

const STATE_LABEL: Record<
  TenorRichness["state"],
  "stateCheap" | "stateFair" | "stateRich" | "stateNa"
> = {
  cheap: "stateCheap",
  fair: "stateFair",
  rich: "stateRich",
  unavailable: "stateNa",
};

function RichnessRow({ richness }: { richness: TenorRichness | null }) {
  const t = useT(ivRankMessages);
  if (!richness) {
    return (
      <div className={styles.richness} data-empty="true">
        {t("noBaseline")}
      </div>
    );
  }
  const level = richnessLevel(richness.state);
  return (
    <HoverTooltip
      as="div"
      className={styles.richness}
      placement="bottom-start"
      content={<RichnessTip />}
    >
      <span className={styles.statePill} data-level={level}>
        {t(STATE_LABEL[richness.state])}
      </span>
      <span className={styles.rankValue} data-level={level}>
        {fmtVolPts(richness.excessPremium)}
      </span>
      <span className={styles.metaRight}>
        <span>{t("hist", { z: fmtZ(richness.excessHistory.zScore) })}</span>
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

export function Chip({
  label,
  result,
  richness,
  showRichness,
  samplesTip = <SamplesTip />,
}: {
  label: string;
  result: IvHistoryTenorResult | undefined;
  richness: TenorRichness | null;
  showRichness: boolean;
  samplesTip?: ReactNode;
}) {
  const t = useT(ivRankMessages);
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
  const gradientId = `ivr-spark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className={styles.chip} data-level={level}>
      <div className={styles.chipHead}>
        <div>
          <div className={styles.chipTenor}>{label}</div>
          <div className={styles.chipIv}>{fmtIv(currentIv)}</div>
        </div>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-end"
          content={<RankTip />}
        >
          <span className={styles.rankBlock} data-level={level}>
            <span className={styles.rankNum}>
              {rank != null ? rank.toFixed(0) : "–"}
            </span>
            <span className={styles.rankCaption}>{t("rank")}</span>
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
          content={<PctTip />}
        >
          {t("pct")}{" "}
          <span className={styles.rankValue} data-level={level}>
            {percentile != null ? `${percentile.toFixed(0)}%` : "–"}
          </span>
        </HoverTooltip>
        <HoverTooltip
          as="span"
          className={styles.badgeTrigger}
          placement="bottom-end"
          content={samplesTip}
        >
          n {n}
        </HoverTooltip>
      </div>

      {showRichness && <RichnessRow richness={richness} />}
    </div>
  );
}

function ConeTip() {
  const t = useT(ivRankMessages);
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{t("coneTipTitle")}</div>
      <div>{t("coneTipBody")}</div>
      <ul className={styles.tipList}>
        <li>{t("coneTipBands")}</li>
        <li>
          <b style={{ color: "var(--accent-primary)" }}>{t("coneTipTeal")}</b>
          {t("coneTipTealBody")}
        </li>
        <li>
          <b style={{ color: "#f7a600" }}>{t("coneTipOrange")}</b>
          {t("coneTipOrangeBody")}
        </li>
        <li>{t("coneTipTop")}</li>
      </ul>
    </div>
  );
}

interface Props {
  underlying: string;
}

function shortestCoverage(
  results: Array<IvHistoryTenorResult | undefined>,
  window: IvHistoryWindow,
  locale: Locale,
): HistoryCoverage {
  const coverages = results.map((result) =>
    getHistoryCoverage(result?.series ?? [], window, ["atmIv"], locale),
  );
  return coverages.reduce((min, item) =>
    item.coverageMs < min.coverageMs ? item : min,
  );
}

export default function IvRankPanel({ underlying }: Props) {
  const t = useT(ivRankMessages);
  const locale = useLocale();
  const [window, setWindow] = useState<IvHistoryWindow>("30d");
  const { data } = useIvHistory(underlying, window);
  const { data: richness } = useVolRichness(underlying);
  const logo = getTokenLogo(underlying);
  const coneIvPoints: ConeIvPoint[] = TENORS.flatMap((tenor) => {
    const iv = data?.tenors[tenor]?.current.atmIv;
    if (iv == null) return [];
    const exact =
      tenor === "7d" || tenor === "30d"
        ? richness?.tenors[tenor].conePercentile
        : null;
    return [{ days: TENOR_DAYS[tenor], iv, exactPercentile: exact }];
  });
  const coverage = shortestCoverage(
    TENORS.map((tenor) => data?.tenors[tenor]),
    window,
    locale,
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <HoverTooltip
          as="span"
          className={styles.title}
          placement="bottom-start"
          content={<IvrTip />}
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
        {TENORS.map((tenor) => (
          <Chip
            key={tenor}
            label={`${tenor.toUpperCase()} ATM`}
            result={data?.tenors[tenor]}
            richness={
              tenor === "7d" || tenor === "30d"
                ? (richness?.tenors[tenor] ?? null)
                : null
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
            content={<ConeTip />}
          >
            <span className={styles.titleTrigger}>{t("coneTitle")}</span>
          </HoverTooltip>
          <div className={styles.legend}>
            <span>
              <i className={styles.lgIv} />
              ATM IV
            </span>
            <span>
              <i className={styles.lgRv} />
              {t("legendRvNow")}
            </span>
            <span>
              <i className={styles.lgMedian} />
              {t("legendMedian")}
            </span>
            <span>
              <i className={styles.lgBand} />
              {t("legendBands")}
            </span>
          </div>
        </div>
        <VolConeChart bands={richness?.volCone ?? []} ivPoints={coneIvPoints} />
      </div>
    </div>
  );
}
