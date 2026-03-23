import { useRef, useEffect } from "react";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, ColorType } from "lightweight-charts";

import { useAppStore } from "@stores/app-store";
import { useChainQuery, useExpiries } from "@features/chain/queries";
import { Spinner } from "@components/ui";
import { formatExpiry, dteDays } from "@lib/format";
import styles from "./VolSmile.module.css";

interface SmilePoint {
  strike: number;
  iv:     number;
}

function averageIv(venues: Record<string, { markIv?: number | null } | undefined>, activeVenues: string[]): number | null {
  let sum = 0;
  let count = 0;

  for (const [venueId, quote] of Object.entries(venues)) {
    if (!activeVenues.includes(venueId) || quote?.markIv == null) continue;
    sum += quote.markIv;
    count += 1;
  }

  return count > 0 ? sum / count : null;
}

function extractSmile(
  strikes: Array<{ strike: number; call: { venues: Record<string, { markIv?: number | null } | undefined> }; put: { venues: Record<string, { markIv?: number | null } | undefined> } }>,
  activeVenues: string[],
  spotPrice: number | null,
): { calls: SmilePoint[]; puts: SmilePoint[] } {
  const calls: SmilePoint[] = [];
  const puts: SmilePoint[] = [];

  for (const s of strikes) {
    const callIv = averageIv(s.call.venues, activeVenues);
    const putIv = averageIv(s.put.venues, activeVenues);

    if (callIv != null) calls.push({ strike: s.strike, iv: callIv * 100 });
    if (putIv != null)  puts.push({ strike: s.strike, iv: putIv * 100 });
  }

  // Filter to strikes within 30% of spot for readability
  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  const inBand = (p: SmilePoint) => !spotPrice || Math.abs(p.strike - spotPrice) <= band;

  return {
    calls: calls.filter(inBand).sort((a, b) => a.strike - b.strike),
    puts:  puts.filter(inBand).sort((a, b) => a.strike - b.strike),
  };
}

const ALL_VENUES = ["deribit", "okx", "bybit", "binance", "derive"];

export default function VolSmile() {
  const underlying   = useAppStore((s) => s.underlying);
  const activeVenues = useAppStore((s) => s.activeVenues);
  const expiry       = useAppStore((s) => s.expiry);
  const { data: expiriesData } = useExpiries(underlying);
  const expiries = expiriesData?.expiries ?? [];

  const smileExpiry = expiry && expiries.includes(expiry)
    ? expiry
    : (expiries.length > 1 ? expiries[1]! : expiries[0] ?? "");

  // Always fetch all venues so toggling doesn't kill the chart.
  // Client-side averageIv filters to activeVenues.
  const { data: chain } = useChainQuery(underlying, smileExpiry, ALL_VENUES);

  const chartRef    = useRef<HTMLDivElement>(null);
  const chartApi    = useRef<IChartApi | null>(null);
  const callSeries  = useRef<ISeriesApi<"Line"> | null>(null);
  const putSeries   = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0A0A0A" },
        textColor: "#555B5E",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1A1A1A" },
        horzLines: { color: "#1A1A1A" },
      },
      rightPriceScale: {
        borderColor: "#1F2937",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#1F2937",
        tickMarkFormatter: (v: number) => v.toLocaleString(),
      },
      crosshair: {
        horzLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
        vertLine: { color: "#50D2C1", labelBackgroundColor: "#0E3333" },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    // Put series first so call line draws on top when values overlap
    const ps = chart.addSeries(LineSeries, {
      color: "#CB3855",
      lineWidth: 2,
      title: "Put IV",
      priceFormat: { type: "custom", formatter: (p: number) => `${p.toFixed(1)}%` },
    });

    const cs = chart.addSeries(LineSeries, {
      color: "#00E997",
      lineWidth: 2,
      title: "Call IV",
      lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (p: number) => `${p.toFixed(1)}%` },
    });

    chartApi.current = chart;
    callSeries.current = cs;
    putSeries.current = ps;

    return () => {
      chart.remove();
      chartApi.current = null;
      callSeries.current = null;
      putSeries.current = null;
    };
  }, []);

  useEffect(() => {
    if (!callSeries.current || !putSeries.current || !chain) return;

    const spot = chain.stats.spotIndexUsd;
    const { calls, puts } = extractSmile(chain.strikes, activeVenues, spot);

    // lightweight-charts requires time as number — use strike as the x-axis value
    callSeries.current.setData(calls.map((p) => ({ time: p.strike as unknown as number, value: p.iv })) as never);
    putSeries.current.setData(puts.map((p) => ({ time: p.strike as unknown as number, value: p.iv })) as never);

    chartApi.current?.timeScale().fitContent();
  }, [chain, activeVenues]);

  if (!chain) {
    return (
      <div className={styles.wrap}>
        <Spinner size="md" label="Loading smile…" />
      </div>
    );
  }

  const dte = smileExpiry ? dteDays(smileExpiry) : null;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Volatility Smile</span>
        <span className={styles.meta}>
          {smileExpiry && formatExpiry(smileExpiry)}
          {dte != null && <span className={styles.dte}>{dte}d</span>}
        </span>
      </div>
      <div className={styles.legend}>
        <span className={styles.legendItem}><span className={styles.legendLine} data-type="call" /> Call IV</span>
        <span className={styles.legendItem}><span className={styles.legendLine} data-type="put" /> Put IV</span>
      </div>
      <div className={styles.chartArea}>
        <div className={styles.chartWrap} ref={chartRef} />
      </div>
    </div>
  );
}
