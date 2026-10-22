import { useSpots } from '@hooks/useSpots';
import { dteDays, fmtUsd, formatExpiry } from '@lib/format';
import { defineMessages, useLocale, useT } from '@lib/i18n';
import type { PublicPositionDto } from '@oggregator/protocol';
import { useId, useMemo, useState, type PointerEvent } from 'react';

import { socialMessages } from './i18n';
import styles from './OpenPositions.module.css';
import {
  groupPositions,
  payoffAt,
  payoffPoints,
  payoffRange,
  payoffSummary,
  strategyName,
  type PositionGroup,
} from './position-payoff';

const messages = defineMessages(
  {
    unrealized: 'Unrealized',
    netCredit: 'Net credit',
    netDebit: 'Net debit',
    legs: 'Legs',
    legsValue: '{long} long · {short} short',
    expiries: 'Expiries',
    groupPositions: '{underlying} {expiry} positions',
    expiring: 'expiring',
    maxProfit: 'Max profit',
    maxLoss: 'Max loss',
    unlimited: 'Unlimited',
    breakeven: 'Breakeven',
    payoffAtExpiry: 'Payoff at expiry',
    spot: 'spot',
    payoffAria: 'Payoff at expiry by underlying price',
  },
  {
    unrealized: 'No realizado',
    netCredit: 'Crédito neto',
    netDebit: 'Débito neto',
    legs: 'Patas',
    legsValue: '{long} long · {short} short',
    expiries: 'Vencimientos',
    groupPositions: 'Posiciones {underlying} {expiry}',
    expiring: 'vence hoy',
    maxProfit: 'Ganancia máx.',
    maxLoss: 'Pérdida máx.',
    unlimited: 'Ilimitada',
    breakeven: 'Breakeven',
    payoffAtExpiry: 'Payoff al vencimiento',
    spot: 'spot',
    payoffAria: 'Payoff al vencimiento según el precio del subyacente',
  },
);

const WIDTH = 320;
const HEIGHT = 96;

function signedUsd(value: number | null): string {
  if (value == null) return '–';
  if (Math.abs(value) < 0.005) return '$0';
  return `${value > 0 ? '+' : ''}${fmtUsd(value)}`;
}

function tone(value: number | null): 'up' | 'down' | 'flat' {
  if (value == null || Math.abs(value) < 0.005) return 'flat';
  return value > 0 ? 'up' : 'down';
}

function compactPrice(price: number): string {
  if (price >= 10_000) return `${Number((price / 1000).toFixed(price >= 100_000 ? 0 : 1))}k`;
  return price.toLocaleString('en-US', {
    maximumFractionDigits: price >= 100 ? 0 : 2,
  });
}

export default function OpenPositions({ positions }: { positions: PublicPositionDto[] }) {
  const t = useT(messages);
  const { data: spots } = useSpots();
  const groups = useMemo(() => groupPositions(positions), [positions]);
  const pnlScale = Math.max(1e-9, ...positions.map((leg) => Math.abs(leg.unrealizedPnlUsd ?? 0)));

  const known = positions.filter((leg) => leg.unrealizedPnlUsd != null);
  const totalPnl = known.length ? known.reduce((s, leg) => s + leg.unrealizedPnlUsd!, 0) : null;
  const netPremium = positions.reduce((s, leg) => s - leg.netQuantity * leg.avgEntryPriceUsd, 0);
  const longs = positions.filter((leg) => leg.netQuantity > 0).length;

  function spotFor(underlying: string): number | null {
    return spots?.find((item) => item.symbol === `${underlying}USDT`)?.lastPrice ?? null;
  }

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <Metric label={t('unrealized')} value={signedUsd(totalPnl)} tone={tone(totalPnl)} />
        <Metric
          label={netPremium >= 0 ? t('netCredit') : t('netDebit')}
          value={signedUsd(Math.abs(netPremium)).replace('+', '')}
        />
        <Metric
          label={t('legs')}
          value={t('legsValue', { long: longs, short: positions.length - longs })}
        />
        <Metric label={t('expiries')} value={String(groups.length)} />
      </div>

      <div className={styles.grid}>
        {groups.map((group) => (
          <GroupCard
            key={group.key}
            group={group}
            spot={spotFor(group.underlying)}
            pnlScale={pnlScale}
          />
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue} data-tone={tone}>
        {value}
      </span>
    </div>
  );
}

function GroupCard({
  group,
  spot,
  pnlScale,
}: {
  group: PositionGroup;
  spot: number | null;
  pnlScale: number;
}) {
  const legs = useMemo(
    () =>
      [...group.legs].sort(
        (a, b) => a.strike - b.strike || a.optionRight.localeCompare(b.optionRight),
      ),
    [group.legs],
  );
  const t = useT(messages);
  const locale = useLocale();
  const summary = useMemo(() => payoffSummary(legs), [legs]);
  const dte = dteDays(group.expiry);

  return (
    <article
      className={styles.card}
      aria-label={t('groupPositions', { underlying: group.underlying, expiry: group.expiry })}
    >
      <header className={styles.cardHeader}>
        <div className={styles.cardTitle}>
          <span className={styles.instrument}>
            {group.underlying} {formatExpiry(group.expiry)}
          </span>
          <span className={styles.dte} data-near={dte <= 2}>
            {dte === 0 ? t('expiring') : `${dte}d`}
          </span>
        </div>
        <span className={styles.strategy}>{strategyName(legs, locale)}</span>
        <span className={styles.groupPnl} data-tone={tone(group.unrealizedPnlUsd)}>
          {signedUsd(group.unrealizedPnlUsd)}
        </span>
      </header>

      <PayoffChart legs={legs} spot={spot} breakevens={summary.breakevens} />

      <dl className={styles.facts}>
        <div>
          <dt>{t('maxProfit')}</dt>
          <dd data-tone="up">
            {summary.maxProfitUsd == null ? t('unlimited') : signedUsd(summary.maxProfitUsd)}
          </dd>
        </div>
        <div>
          <dt>{t('maxLoss')}</dt>
          <dd data-tone="down">
            {summary.maxLossUsd == null ? t('unlimited') : signedUsd(summary.maxLossUsd)}
          </dd>
        </div>
        <div>
          <dt>{t('breakeven')}</dt>
          <dd>
            {summary.breakevens.length
              ? summary.breakevens.map((price) => compactPrice(price)).join(' / ')
              : '–'}
          </dd>
        </div>
      </dl>

      <ul className={styles.legs}>
        {legs.map((leg) => (
          <LegRow key={`${leg.strike}|${leg.optionRight}`} leg={leg} pnlScale={pnlScale} />
        ))}
      </ul>
    </article>
  );
}

function LegRow({ leg, pnlScale }: { leg: PublicPositionDto; pnlScale: number }) {
  const ts = useT(socialMessages);
  const long = leg.netQuantity > 0;
  const pnl = leg.unrealizedPnlUsd;
  const width = pnl == null ? 0 : Math.min(100, (Math.abs(pnl) / pnlScale) * 100);
  const move =
    leg.markPriceUsd != null && leg.avgEntryPriceUsd > 0
      ? (leg.markPriceUsd - leg.avgEntryPriceUsd) / leg.avgEntryPriceUsd
      : null;

  return (
    <li className={styles.leg}>
      <span className={styles.side} data-side={long ? 'long' : 'short'}>
        {long ? ts('long') : ts('short')}
      </span>
      <span className={styles.legQty}>{Math.abs(leg.netQuantity)}</span>
      <span className={styles.legStrike}>
        {leg.strike.toLocaleString()}
        <span className={styles.right} data-right={leg.optionRight}>
          {leg.optionRight === 'call' ? 'C' : 'P'}
        </span>
      </span>
      <span className={styles.legPrices}>
        {fmtUsd(leg.avgEntryPriceUsd)}
        <span className={styles.arrow}>→</span>
        <span>{fmtUsd(leg.markPriceUsd)}</span>
        {move != null && (
          <span className={styles.move} data-tone={tone(move)}>
            {move > 0 ? '+' : ''}
            {(move * 100).toFixed(0)}%
          </span>
        )}
      </span>
      <span className={styles.legPnl}>
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.barFill} data-tone={tone(pnl)} style={{ width: `${width}%` }} />
        </span>
        <span data-tone={tone(pnl)}>{signedUsd(pnl)}</span>
      </span>
    </li>
  );
}

function PayoffChart({
  legs,
  spot,
  breakevens,
}: {
  legs: PublicPositionDto[];
  spot: number | null;
  breakevens: number[];
}) {
  const t = useT(messages);
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [from, to] = payoffRange(legs, spot, breakevens);
  const points = payoffPoints(legs, from, to);
  const pnls = points.map((point) => point.pnl);
  const lo = Math.min(0, ...pnls);
  const hi = Math.max(0, ...pnls);
  const pad = (hi - lo) * 0.12 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (price: number) => ((price - from) / (to - from)) * WIDTH;
  const y = (pnl: number) => HEIGHT - ((pnl - yMin) / (yMax - yMin)) * HEIGHT;
  const pct = (price: number) => `${((price - from) / (to - from)) * 100}%`;
  const zeroY = y(0);
  const line = points.map((point) => `${x(point.price).toFixed(2)},${y(point.pnl).toFixed(2)}`);
  const area = `${x(from)},${zeroY} ${line.join(' ')} ${x(to)},${zeroY}`;
  const strikes = [...new Set(legs.map((leg) => leg.strike))];
  const spotInRange = spot != null && spot >= from && spot <= to;
  const hoverPnl = hover == null ? null : payoffAt(legs, hover);

  function onMove(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover(from + ratio * (to - from));
  }

  return (
    <div className={styles.payoff}>
      <div className={styles.payoffHead}>
        <span>{t('payoffAtExpiry')}</span>
        {hover != null ? (
          <span className={styles.readout}>
            @ {compactPrice(hover)}
            <span data-tone={tone(hoverPnl)}>{signedUsd(hoverPnl)}</span>
          </span>
        ) : spotInRange ? (
          <span className={styles.readout}>
            {t('spot')} {compactPrice(spot)}
            <span data-tone={tone(payoffAt(legs, spot))}>{signedUsd(payoffAt(legs, spot))}</span>
          </span>
        ) : null}
      </div>
      <div className={styles.plot} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t('payoffAria')}
        >
          <defs>
            <clipPath id={`${clipId}-up`}>
              <rect x={0} y={0} width={WIDTH} height={Math.max(0, zeroY)} />
            </clipPath>
            <clipPath id={`${clipId}-down`}>
              <rect x={0} y={zeroY} width={WIDTH} height={Math.max(0, HEIGHT - zeroY)} />
            </clipPath>
          </defs>
          <polygon className={styles.profitArea} points={area} clipPath={`url(#${clipId}-up)`} />
          <polygon className={styles.lossArea} points={area} clipPath={`url(#${clipId}-down)`} />
          <line
            className={styles.zero}
            x1={0}
            x2={WIDTH}
            y1={zeroY}
            y2={zeroY}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            className={styles.profitLine}
            points={line.join(' ')}
            clipPath={`url(#${clipId}-up)`}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            className={styles.lossLine}
            points={line.join(' ')}
            clipPath={`url(#${clipId}-down)`}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {strikes.map((strike) => (
          <span key={strike} className={styles.strikeTick} style={{ left: pct(strike) }} />
        ))}
        {spotInRange && (
          <span className={styles.spotLine} style={{ left: pct(spot) }}>
            <span
              className={styles.spotDot}
              style={{ top: `${(y(payoffAt(legs, spot)) / HEIGHT) * 100}%` }}
            />
          </span>
        )}
        {hover != null && <span className={styles.hoverLine} style={{ left: pct(hover) }} />}
      </div>
      <div className={styles.axis}>
        {strikes.map((strike) => (
          <span key={strike} className={styles.axisLabel} style={{ left: pct(strike) }}>
            {compactPrice(strike)}
          </span>
        ))}
      </div>
    </div>
  );
}
