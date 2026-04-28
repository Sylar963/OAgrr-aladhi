import styles from './BasisTooltip.module.css';

type Tone = 'bull' | 'bear' | 'mixed' | 'neutral';
type Bucket = 'flat' | 'tilt-up' | 'euphoric' | 'tilt-down' | 'stress';

interface BasisTooltipProps {
  basisPct: number | null;
  dte: number;
}

const FLAT_ANN = 3;
const TILT_ANN = 9;
const EUPHORIC_ANN = 27;

interface Row {
  bucket: Bucket;
  tone: Tone;
  range: string;
  example: string;
  read: string;
}

const ROWS: Row[] = [
  {
    bucket: 'flat',
    tone: 'neutral',
    range: '|ann| < 3%',
    example: '±0.017% / 4d → ~1.5%',
    read: 'Flat — no directional conviction priced in',
  },
  {
    bucket: 'tilt-up',
    tone: 'bull',
    range: '+3% ≤ ann < +27%',
    example: '+0.1% / 4d → ~+9%',
    read: 'Meaningful contango — healthy long carry',
  },
  {
    bucket: 'euphoric',
    tone: 'bear',
    range: 'ann ≥ +27%',
    example: '>+0.3% / 4d → >+27%',
    read: 'Euphoric — crowded longs, mean-reversion risk',
  },
  {
    bucket: 'tilt-down',
    tone: 'mixed',
    range: '−9% < ann ≤ −3%',
    example: '−0.05% / 4d → ~−4.5%',
    read: 'Mild backwardation — passive deleveraging',
  },
  {
    bucket: 'stress',
    tone: 'bear',
    range: 'ann ≤ −9%',
    example: '<−0.1% / 4d → <−9%',
    read: 'Real stress — watch for liquidation cascade',
  },
];

function classify(annPct: number): Bucket {
  if (Math.abs(annPct) < FLAT_ANN) return 'flat';
  if (annPct >= EUPHORIC_ANN) return 'euphoric';
  if (annPct >= FLAT_ANN) return 'tilt-up';
  if (annPct <= -TILT_ANN) return 'stress';
  return 'tilt-down';
}

function fmtAnn(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export default function BasisTooltip({ basisPct, dte }: BasisTooltipProps) {
  const annPct = basisPct != null && dte > 0 ? basisPct * (365 / dte) : null;
  const current = annPct != null ? classify(annPct) : null;

  return (
    <div className={styles.tooltip} role="tooltip">
      <div className={styles.header}>
        <span className={styles.headerLabel}>Annualized basis</span>
        {annPct != null ? (
          <span className={styles.headerValue} data-tone={current ? toneOf(current) : undefined}>
            {fmtAnn(annPct)}
          </span>
        ) : (
          <span className={styles.headerValue}>–</span>
        )}
      </div>
      <div className={styles.formula}>basis% × (365/{dte}d)</div>

      <div className={styles.divider} />

      <ul className={styles.list}>
        {ROWS.map((row) => (
          <li
            key={row.bucket}
            className={styles.row}
            data-active={current === row.bucket ? 'true' : undefined}
          >
            <span className={styles.badge} data-tone={row.tone} />
            <div className={styles.rowBody}>
              <div className={styles.rowHead}>
                <span className={styles.range}>{row.range}</span>
                <span className={styles.example}>{row.example}</span>
              </div>
              <div className={styles.read}>{row.read}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function toneOf(b: Bucket): Tone {
  return ROWS.find((r) => r.bucket === b)?.tone ?? 'neutral';
}
