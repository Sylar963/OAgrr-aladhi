import { useMemo, useState, type MouseEvent } from 'react';

import styles from './GreekProfileChart.module.css';

export interface ProfileLine {
  label: string;
  values: number[];
  dashed?: boolean;
  emphasis: number;
}

export interface StrikeMarker {
  strike: number;
  positive: boolean;
}

interface Props {
  xs: number[];
  lines: ProfileLine[];
  color: string;
  lossColor: string;
  anchorX: number | null;
  anchorLabel: string;
  markers: StrikeMarker[];
  activeStrike: number | null;
  onSelectStrike: (strike: number) => void;
  formatX: (value: number) => string;
  formatTick: (value: number, step: number) => string;
  formatValue: (value: number) => string;
  stale: boolean;
}

const WIDTH = 760;
const HEIGHT = 250;
const PADDING = { top: 24, right: 20, bottom: 38, left: 72 };
const TOOLTIP_WIDTH = 204;

function niceStep(rawStep: number): number {
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function ticksFor(lo: number, hi: number, count: number): { ticks: number[]; step: number } {
  const step = niceStep((hi - lo) / count);
  const ticks: number[] = [];
  for (let tick = Math.ceil(lo / step) * step; tick <= hi + step * 1e-9; tick += step) {
    ticks.push(Math.abs(tick) < step * 1e-9 ? 0 : tick);
  }
  return { ticks, step };
}

export default function GreekProfileChart({
  xs,
  lines,
  color,
  lossColor,
  anchorX,
  anchorLabel,
  markers,
  activeStrike,
  onSelectStrike,
  formatX,
  formatTick,
  formatValue,
  stale,
}: Props) {
  const [rawHoverIndex, setHoverIndex] = useState<number | null>(null);
  const hoverIndex =
    rawHoverIndex == null || xs.length === 0 ? null : Math.min(rawHoverIndex, xs.length - 1);

  const geometry = useMemo(() => {
    if (xs.length < 2 || lines.length === 0) return null;
    const allValues = lines.flatMap((line) => line.values).filter(Number.isFinite);
    const rawLo = Math.min(0, ...allValues);
    const rawHi = Math.max(0, ...allValues);
    const span = Math.max(rawHi - rawLo, Math.max(Math.abs(rawHi), Math.abs(rawLo), 1e-9) * 0.5);
    const yLo = rawLo - span * 0.1;
    const yHi = rawHi + span * 0.1;
    const xLo = xs[0]!;
    const xHi = xs[xs.length - 1]!;
    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const toX = (value: number) => PADDING.left + ((value - xLo) / (xHi - xLo)) * innerW;
    const toY = (value: number) => PADDING.top + ((yHi - value) / (yHi - yLo)) * innerH;
    const paths = lines.map((line) =>
      line.values
        .map((value, index) => `${index === 0 ? 'M' : 'L'}${toX(xs[index]!).toFixed(2)},${toY(value).toFixed(2)}`)
        .join(''),
    );
    const zeroY = toY(0);
    const primary = lines[0]!;
    const area = `${paths[0]}L${toX(xHi).toFixed(2)},${zeroY.toFixed(2)}L${toX(xLo).toFixed(2)},${zeroY.toFixed(2)}Z`;
    return {
      toX,
      toY,
      zeroY,
      paths,
      area,
      primary,
      yTicks: ticksFor(yLo, yHi, 4),
      xTicks: ticksFor(xLo, xHi, 6),
      xLo,
      xHi,
    };
  }, [lines, xs]);

  if (geometry == null) return null;

  const plotBottom = HEIGHT - PADDING.bottom;
  const plotRight = WIDTH - PADDING.right;
  const visibleMarkers = markers.filter(
    (marker) => marker.strike >= geometry.xLo && marker.strike <= geometry.xHi,
  );

  const handleMove = (event: MouseEvent<SVGRectElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    const ctm = svg?.getScreenCTM();
    if (svg == null || ctm == null) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    let nearest = 0;
    for (let index = 1; index < xs.length; index += 1) {
      if (
        Math.abs(geometry.toX(xs[index]!) - point.x) <
        Math.abs(geometry.toX(xs[nearest]!) - point.x)
      ) {
        nearest = index;
      }
    }
    setHoverIndex(nearest);
  };

  const hoverX = hoverIndex == null ? null : geometry.toX(xs[hoverIndex]!);
  const tooltipLeft =
    hoverX == null
      ? 0
      : hoverX + 12 + TOOLTIP_WIDTH > plotRight
        ? hoverX - 12 - TOOLTIP_WIDTH
        : hoverX + 12;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={`${styles.svg} ${stale ? styles.stale : ''}`}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <rect
        x={PADDING.left}
        y={PADDING.top}
        width={plotRight - PADDING.left}
        height={Math.max(0, geometry.zeroY - PADDING.top)}
        fill="rgba(80, 210, 193, 0.025)"
      />
      <rect
        x={PADDING.left}
        y={geometry.zeroY}
        width={plotRight - PADDING.left}
        height={Math.max(0, plotBottom - geometry.zeroY)}
        fill="rgba(239, 97, 119, 0.025)"
      />

      {geometry.yTicks.ticks.map((tick) => {
        const y = geometry.toY(tick);
        return (
          <g key={`y${tick}`}>
            <line
              x1={PADDING.left}
              x2={plotRight}
              y1={y}
              y2={y}
              stroke={tick === 0 ? '#44504d' : '#1b2321'}
              strokeDasharray={tick === 0 ? '4 4' : undefined}
            />
            <text x={PADDING.left - 9} y={y + 3} textAnchor="end" fontSize={10} fill="#74807d">
              {formatTick(tick, geometry.yTicks.step)}
            </text>
          </g>
        );
      })}

      {geometry.xTicks.ticks.map((tick) => (
        <text
          key={`x${tick}`}
          x={geometry.toX(tick)}
          y={plotBottom + 30}
          textAnchor="middle"
          fontSize={9}
          fill="#55605d"
        >
          {formatX(tick)}
        </text>
      ))}

      {visibleMarkers.map((marker) => {
        const x = geometry.toX(marker.strike);
        const selected = marker.strike === activeStrike;
        return (
          <line
            key={`guide${marker.strike}`}
            x1={x}
            x2={x}
            y1={PADDING.top}
            y2={plotBottom}
            stroke={selected ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.04)'}
            pointerEvents="none"
          />
        );
      })}

      <path d={geometry.area} fill={color} opacity={0.07} pointerEvents="none" />
      {lines
        .map((line, index) => ({ line, path: geometry.paths[index]! }))
        .reverse()
        .map(({ line, path }) => (
          <path
            key={line.label}
            d={path}
            fill="none"
            stroke={color}
            strokeOpacity={line.emphasis}
            strokeWidth={line.emphasis >= 1 ? 2 : 1.3}
            strokeDasharray={line.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ))}

      {anchorX != null && anchorX >= geometry.xLo && anchorX <= geometry.xHi && (
        <g pointerEvents="none">
          <line
            x1={geometry.toX(anchorX)}
            x2={geometry.toX(anchorX)}
            y1={PADDING.top - 6}
            y2={plotBottom}
            stroke="#9aa8a4"
            strokeDasharray="2 3"
          />
          <text
            x={geometry.toX(anchorX)}
            y={PADDING.top - 10}
            textAnchor="middle"
            fontSize={9}
            fill="#9aa8a4"
          >
            {anchorLabel}
          </text>
        </g>
      )}

      <rect
        x={PADDING.left}
        y={PADDING.top}
        width={plotRight - PADDING.left}
        height={plotBottom - PADDING.top}
        fill="transparent"
        onMouseMove={handleMove}
      />

      {visibleMarkers.map((marker) => {
        const x = geometry.toX(marker.strike);
        const selected = marker.strike === activeStrike;
        return (
          <g
            key={`marker${marker.strike}`}
            className={styles.marker}
            onClick={() => onSelectStrike(marker.strike)}
            onMouseEnter={() => onSelectStrike(marker.strike)}
          >
            <title>{`Strike ${formatX(marker.strike)}`}</title>
            <rect x={x - 9} y={plotBottom - 10} width={18} height={26} fill="transparent" />
            <path
              d={`M${x},${plotBottom - 7}L${x + 5},${plotBottom + 1}L${x - 5},${plotBottom + 1}Z`}
              fill={marker.positive ? color : lossColor}
              stroke={selected ? '#eef5f3' : 'none'}
              opacity={selected ? 1 : 0.75}
            />
            {selected && (
              <text
                x={x}
                y={plotBottom + 14}
                textAnchor="middle"
                fontSize={9}
                fill="#dbe5e2"
              >
                {formatX(marker.strike)}
              </text>
            )}
          </g>
        );
      })}

      {hoverIndex != null && hoverX != null && (
        <g pointerEvents="none">
          <line x1={hoverX} x2={hoverX} y1={PADDING.top} y2={plotBottom} stroke="#5d6966" />
          {lines.map((line) => (
            <circle
              key={line.label}
              cx={hoverX}
              cy={geometry.toY(line.values[hoverIndex]!)}
              r={line.emphasis >= 1 ? 3.5 : 2.5}
              fill={color}
              fillOpacity={line.emphasis}
              stroke="#0d0f0f"
            />
          ))}
          <rect
            x={tooltipLeft}
            y={PADDING.top + 4}
            width={TOOLTIP_WIDTH}
            height={22 + lines.length * 14}
            rx={4}
            fill="#121716"
            stroke="#2a3331"
          />
          <text x={tooltipLeft + 9} y={PADDING.top + 19} fontSize={9} fill="#dbe5e2">
            {formatX(xs[hoverIndex]!)}
          </text>
          {lines.map((line, index) => (
            <g key={line.label}>
              <text
                x={tooltipLeft + 9}
                y={PADDING.top + 34 + index * 14}
                fontSize={9}
                fill="#7f8b88"
              >
                {line.label}
              </text>
              <text
                x={tooltipLeft + TOOLTIP_WIDTH - 9}
                y={PADDING.top + 34 + index * 14}
                fontSize={9}
                textAnchor="end"
                fill={line.values[hoverIndex]! >= 0 ? '#58dbc9' : '#ef7185'}
              >
                {formatValue(line.values[hoverIndex]!)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}
