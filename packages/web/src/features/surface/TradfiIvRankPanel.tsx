import { useState } from 'react';

import HoverTooltip from '@components/ui/HoverTooltip';
import { useTradfiSelection } from '@features/tradfi';
import type { TradfiVolHistoryResponse, TradfiVolRank } from '@oggregator/protocol';
import type { IvHistoryPoint, IvHistoryTenorResult } from '@shared/enriched';
import { Chip } from './IvRankPanel';
import { useSurface, useTradfiVolHistory } from './queries';
import { TRADFI_SURFACE_VENUES } from './surface-market';
import VolConeChart, { type ConeIvPoint } from './VolConeChart';
import styles from './IvRankPanel.module.css';

type Lookback = '6m' | '1y';
type Field = 'iv' | 'rv';

const CONE_TENORS = [
  ['7d', 7],
  ['30d', 30],
  ['60d', 60],
  ['90d', 90],
] as const;

const LOOKBACKS: Lookback[] = ['6m', '1y'];

function latest(series: TradfiVolHistoryResponse['series'], field: Field) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i]![field] != null) return series[i]!;
  return undefined;
}

function point(ts: number, value: number | null): IvHistoryPoint {
  return { ts, atmIv: value, rr25d: null, bfly25d: null, rr10d: null, bfly10d: null };
}

/** Feeds a daily IV or RV series to the crypto chip, which reads only the ATM fields. */
function chipResult(
  history: TradfiVolHistoryResponse,
  rank: TradfiVolRank,
  field: Field,
): IvHistoryTenorResult {
  const window = history.series.slice(-rank.lookbackDays);
  const last = latest(window, field);
  return {
    current: point(last?.ts ?? 0, last?.[field] ?? null),
    atmRank: rank.rank,
    atmPercentile: rank.percentile,
    rrRank: null,
    rrPercentile: null,
    flyRank: null,
    flyPercentile: null,
    min: { atmIv: rank.min, rr25d: null, bfly25d: null },
    max: { atmIv: rank.max, rr25d: null, bfly25d: null },
    series: window.map((p) => point(p.ts, p[field])),
  };
}

const TITLE_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>How to read IV Rank</div>
    <div>Where today&apos;s value sits within the look-back window (toggle above the chips).</div>
    <div className={styles.tipFormula}>rank = (current − min) / (max − min) × 100</div>
    <ul className={styles.tipList}>
      <li>
        <b>30D IV</b>: TastyTrade&apos;s daily 30-day implied vol for the ticker. Index products
        use their published vol index instead (VIX for SPX/SPY/XSP, RVX for RUT/IWM).
      </li>
      <li>
        <b>21D RV</b>: close-to-close realized vol over the last 21 trading days, annualized
        over 252 trading days.
      </li>
      <li>6M = 126 trading days, 1Y = 252.</li>
    </ul>
  </div>
);

const SAMPLES_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>Samples</div>
    <div>Trading days with a value inside the selected window, from daily candles.</div>
  </div>
);

const CONE_TIP = (
  <div className={styles.tip}>
    <div className={styles.tipTitle}>Vol cone</div>
    <div>
      Grey bands: distribution of realized vol over every rolling window of each horizon, from
      ~3 years of daily closes. Horizons of 7/14/30/60/90 calendar days use 5/10/21/42/63
      trading-day windows.
    </div>
    <ul className={styles.tipList}>
      <li>Darkest band 25–75th pct, then 10–90th, then min–max. Dashed line is the median.</li>
      <li>
        <b style={{ color: 'var(--accent-primary)' }}>Teal</b>: current ATM IV term structure from
        the live surface, labelled with its percentile inside each band.
      </li>
      <li>
        <b style={{ color: '#f7a600' }}>Orange</b>: realized vol over the trailing window of each
        horizon.
      </li>
    </ul>
  </div>
);

export default function TradfiIvRankPanel() {
  const { underlying } = useTradfiSelection();
  const [lookback, setLookback] = useState<Lookback>('1y');
  const { data } = useTradfiVolHistory(underlying);
  const { data: surface } = useSurface(underlying, TRADFI_SURFACE_VENUES, 'tradfi');
  const coneIvPoints: ConeIvPoint[] = CONE_TENORS.flatMap(([tenor, days]) => {
    const iv = surface?.atmIvTenors?.[tenor];
    return iv == null ? [] : [{ days, iv }];
  });
  const first = data?.series[0];

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <HoverTooltip as="span" className={styles.title} placement="bottom-start" content={TITLE_TIP}>
          <span className={styles.titleTrigger}>{underlying} IV RANK</span>
        </HoverTooltip>
        <div className={styles.windowToggle}>
          {LOOKBACKS.map((w) => (
            <button
              key={w}
              type="button"
              className={styles.windowBtn}
              data-active={lookback === w ? 'true' : undefined}
              onClick={() => setLookback(w)}
            >
              {w.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.coverage}>
        {first
          ? `Daily since ${new Date(first.ts).toISOString().slice(0, 10)} · IV source ${data.ivSource}`
          : 'Loading daily history…'}
      </div>

      <div className={styles.grid} data-cols="2">
        <Chip
          label={`30D IV · ${data?.ivSource ?? 'IVx'}`}
          result={data ? chipResult(data, data.ivRank[lookback], 'iv') : undefined}
          richness={null}
          showRichness={false}
          samplesTip={SAMPLES_TIP}
        />
        <Chip
          label={`${data?.rvWindowDays ?? 21}D RV`}
          result={data ? chipResult(data, data.rvRank[lookback], 'rv') : undefined}
          richness={null}
          showRichness={false}
          samplesTip={SAMPLES_TIP}
        />
      </div>

      <div className={styles.coneSection}>
        <div className={styles.coneHeader}>
          <HoverTooltip as="span" className={styles.coneTitle} placement="bottom-start" content={CONE_TIP}>
            <span className={styles.titleTrigger}>VOL CONE · IV vs realized</span>
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
        <VolConeChart bands={data?.volCone ?? []} ivPoints={coneIvPoints} />
      </div>
    </div>
  );
}
