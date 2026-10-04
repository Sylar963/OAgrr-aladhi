import { useLayoutEffect, useRef, useState } from "react";

import type { VolConeBand } from "@oggregator/protocol";

import { fmtIv } from "@lib/format";
import styles from "./VolConeChart.module.css";

export interface ConeIvPoint {
  days: number;
  iv: number;
  /** Server-computed cone percentile; omitted tenors are estimated from the band quantiles. */
  exactPercentile?: number | null;
}

interface Props {
  bands: VolConeBand[];
  ivPoints: ConeIvPoint[];
}

const MARGIN = { top: 14, right: 16, bottom: 22, left: 40 };
const QUANTILE_KNOTS = [
  ["min", 0],
  ["p10", 10],
  ["p25", 25],
  ["p50", 50],
  ["p75", 75],
  ["p90", 90],
  ["max", 100],
] as const;

/** Linear interpolation between the published quantiles; outside the cone returns null. */
export function estimateConePercentile(
  band: VolConeBand,
  vol: number,
): number | null {
  if (vol < band.min || vol > band.max) return null;
  for (let i = 1; i < QUANTILE_KNOTS.length; i++) {
    const [loKey, loPct] = QUANTILE_KNOTS[i - 1]!;
    const [hiKey, hiPct] = QUANTILE_KNOTS[i]!;
    const lo = band[loKey];
    const hi = band[hiKey];
    if (vol <= hi)
      return hi > lo
        ? loPct + ((vol - lo) / (hi - lo)) * (hiPct - loPct)
        : hiPct;
  }
  return 100;
}

function percentileLabel(
  band: VolConeBand | undefined,
  point: ConeIvPoint,
): string {
  if (point.exactPercentile != null)
    return `p${point.exactPercentile.toFixed(0)}`;
  if (!band) return "";
  if (point.iv > band.max) return ">max";
  if (point.iv < band.min) return "<min";
  const est = estimateConePercentile(band, point.iv);
  return est == null ? "" : `≈p${est.toFixed(0)}`;
}

function niceStep(span: number): number {
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * pow;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export default function VolConeChart({ bands, ivPoints }: Props) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  if (bands.length < 2) {
    return (
      <div ref={ref} className={styles.wrap}>
        <div className={styles.empty}>
          Vol cone needs ≥ 2 horizons of spot history
        </div>
      </div>
    );
  }

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = Math.max(0, height - MARGIN.top - MARGIN.bottom);
  const minDays = bands[0]!.horizonDays;
  const maxDays = bands[bands.length - 1]!.horizonDays;
  const logSpan = Math.log(maxDays) - Math.log(minDays);
  const x = (days: number) =>
    MARGIN.left + ((Math.log(days) - Math.log(minDays)) / logSpan) * innerW;

  const plotted = ivPoints.filter(
    (p) => p.days >= minDays && p.days <= maxDays,
  );
  const values = [
    ...bands.flatMap((b) => [b.min, b.max, b.current ?? b.p50]),
    ...plotted.map((p) => p.iv),
  ];
  const step = niceStep(
    Math.max(Math.max(...values) - Math.min(...values), 0.04),
  );
  const yMin = Math.max(0, Math.floor(Math.min(...values) / step) * step);
  const yMax = Math.ceil(Math.max(...values) / step) * step;
  const y = (vol: number) =>
    MARGIN.top + innerH - ((vol - yMin) / (yMax - yMin)) * innerH;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) yTicks.push(v);

  const area = (lo: keyof VolConeBand, hi: keyof VolConeBand) => {
    const top = bands.map((b) => `${x(b.horizonDays)},${y(b[hi] as number)}`);
    const bottom = [...bands]
      .reverse()
      .map((b) => `${x(b.horizonDays)},${y(b[lo] as number)}`);
    return `M${top.join("L")}L${bottom.join("L")}Z`;
  };
  const line = (points: Array<[number, number]>) =>
    points.map(([d, v], i) => `${i === 0 ? "M" : "L"}${x(d)},${y(v)}`).join("");

  const rvPoints = bands
    .filter((b) => b.current != null)
    .map((b): [number, number] => [b.horizonDays, b.current!]);
  const bandByDays = new Map(bands.map((b) => [b.horizonDays, b]));
  const hovered = hover != null ? bands[hover] : undefined;
  const hoveredIv = hovered
    ? plotted.find((p) => p.days === hovered.horizonDays)
    : undefined;

  function onMove(event: React.MouseEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left + MARGIN.left;
    let best = 0;
    bands.forEach((b, i) => {
      if (
        Math.abs(x(b.horizonDays) - px) <
        Math.abs(x(bands[best]!.horizonDays) - px)
      )
        best = i;
    });
    setHover(best);
  }

  return (
    <div ref={ref} className={styles.wrap}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} className={styles.svg}>
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(v)}
                y2={y(v)}
                className={styles.grid}
              />
              <text x={MARGIN.left - 6} y={y(v)} className={styles.yLabel}>
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          ))}
          {bands.map((b) => (
            <text
              key={b.horizonDays}
              x={x(b.horizonDays)}
              y={height - 6}
              className={styles.xLabel}
            >
              {b.horizonDays}d
            </text>
          ))}

          <path d={area("min", "max")} className={styles.bandOuter} />
          <path d={area("p10", "p90")} className={styles.bandMid} />
          <path d={area("p25", "p75")} className={styles.bandInner} />
          <path
            d={line(bands.map((b) => [b.horizonDays, b.p50]))}
            className={styles.median}
          />

          {hovered && (
            <line
              x1={x(hovered.horizonDays)}
              x2={x(hovered.horizonDays)}
              y1={MARGIN.top}
              y2={MARGIN.top + innerH}
              className={styles.crosshair}
            />
          )}

          {rvPoints.length > 1 && (
            <path d={line(rvPoints)} className={styles.rvLine} />
          )}
          {rvPoints.map(([d, v]) => (
            <circle
              key={d}
              cx={x(d)}
              cy={y(v)}
              r={2.5}
              className={styles.rvDot}
            />
          ))}

          {plotted.length > 1 && (
            <path
              d={line(plotted.map((p) => [p.days, p.iv]))}
              className={styles.ivLine}
            />
          )}
          {plotted.map((p) => (
            <g key={p.days}>
              <circle
                cx={x(p.days)}
                cy={y(p.iv)}
                r={3.5}
                className={styles.ivDot}
              />
              <text x={x(p.days)} y={y(p.iv) - 8} className={styles.ivLabel}>
                {percentileLabel(bandByDays.get(p.days), p)}
              </text>
            </g>
          ))}

          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      )}

      {hovered && (
        <div
          className={styles.tooltip}
          style={{
            left: x(hovered.horizonDays),
            transform: `translateX(${x(hovered.horizonDays) > width / 2 ? "calc(-100% - 10px)" : "10px"})`,
          }}
        >
          <div className={styles.tooltipTitle}>
            {hovered.horizonDays}d realized · {hovered.sampleCount} windows
          </div>
          {hoveredIv && (
            <div className={styles.tooltipRow}>
              <span className={styles.swIv} />
              ATM IV <b>{fmtIv(hoveredIv.iv)}</b>
              <span className={styles.dim}>
                {percentileLabel(hovered, hoveredIv)}
              </span>
            </div>
          )}
          <div className={styles.tooltipRow}>
            <span className={styles.swRv} />
            RV now <b>{fmtIv(hovered.current)}</b>
          </div>
          <div className={styles.tooltipGrid}>
            <span>max</span>
            <b>{fmtIv(hovered.max)}</b>
            <span>p90</span>
            <b>{fmtIv(hovered.p90)}</b>
            <span>p75</span>
            <b>{fmtIv(hovered.p75)}</b>
            <span>median</span>
            <b>{fmtIv(hovered.p50)}</b>
            <span>p25</span>
            <b>{fmtIv(hovered.p25)}</b>
            <span>p10</span>
            <b>{fmtIv(hovered.p10)}</b>
            <span>min</span>
            <b>{fmtIv(hovered.min)}</b>
          </div>
        </div>
      )}
    </div>
  );
}
