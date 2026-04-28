import HoverTooltip from '@components/ui/HoverTooltip';
import styles from './RegimeChip.module.css';

type Tone = 'bull' | 'bear' | 'mixed' | 'neutral' | 'unknown';

interface RegimeChipProps {
  basisPct: number | null;
  skew25d: number | null;
  ivChange1d: number | null | undefined;
  putCallOiRatio: number | null;
}

const BASIS_FLAT = 0.01;
const SKEW_FLAT = 0.005;
const IV_FLAT = 0.002;
const PC_HIGH = 1.1;
const PC_LOW = 0.9;

type Sign3 = 'pos' | 'neg' | 'flat';
type PcBucket = 'high' | 'low' | 'flat';

function sign(value: number | null | undefined, flat: number): Sign3 | null {
  if (value == null) return null;
  if (Math.abs(value) < flat) return 'flat';
  return value > 0 ? 'pos' : 'neg';
}

function pcBucket(pc: number | null): PcBucket | null {
  if (pc == null) return null;
  if (pc > PC_HIGH) return 'high';
  if (pc < PC_LOW) return 'low';
  return 'flat';
}

function basisSkewTone(b: Sign3 | null, s: Sign3 | null): { tone: Tone; label: string } {
  if (!b || !s) return { tone: 'unknown', label: 'No skew data' };
  if (b === 'flat' || s === 'flat') return { tone: 'neutral', label: 'Flat carry / skew' };
  if (b === 'pos' && s === 'pos') return { tone: 'bull', label: 'Healthy call-led carry' };
  if (b === 'pos' && s === 'neg') return { tone: 'mixed', label: 'Fragile rally — longs hedging' };
  if (b === 'neg' && s === 'pos') return { tone: 'bull', label: 'Washed-out shorts — turn?' };
  return { tone: 'bear', label: 'Stress — basis & puts both bid' };
}

function basisIvTone(b: Sign3 | null, iv: Sign3 | null): { tone: Tone; label: string } {
  if (!b || !iv) return { tone: 'unknown', label: 'No IV Δ data' };
  if (b === 'flat') return { tone: 'neutral', label: 'Flat carry' };
  if (b === 'neg' && iv === 'pos') return { tone: 'bear', label: 'Active panic — backwardation + IV bid' };
  if (b === 'neg' && (iv === 'neg' || iv === 'flat'))
    return { tone: 'mixed', label: 'Passive deleveraging' };
  if (b === 'pos' && (iv === 'neg' || iv === 'flat'))
    return { tone: 'bull', label: 'Stable carry, vol bleeding' };
  return { tone: 'mixed', label: 'Vol expanding into rally' };
}

function basisPcTone(b: Sign3 | null, pc: PcBucket | null): { tone: Tone; label: string } {
  if (!b || !pc) return { tone: 'unknown', label: 'No P/C data' };
  if (b === 'flat') return { tone: 'neutral', label: 'Flat carry' };
  if (b === 'pos' && pc === 'high') return { tone: 'bull', label: 'Hedged grind higher' };
  if (b === 'neg' && pc === 'low') return { tone: 'bear', label: 'Directional shorts — squeeze setup' };
  if (b === 'pos' && pc === 'low') return { tone: 'mixed', label: 'Unhedged longs' };
  if (b === 'neg' && pc === 'high') return { tone: 'mixed', label: 'Hedged downside' };
  return { tone: 'neutral', label: 'Balanced positioning' };
}

export default function RegimeChip({
  basisPct,
  skew25d,
  ivChange1d,
  putCallOiRatio,
}: RegimeChipProps) {
  const b = sign(basisPct, BASIS_FLAT);
  const s = sign(skew25d, SKEW_FLAT);
  const iv = sign(ivChange1d, IV_FLAT);
  const pc = pcBucket(putCallOiRatio);

  const bs = basisSkewTone(b, s);
  const biv = basisIvTone(b, iv);
  const bpc = basisPcTone(b, pc);

  const tooltipContent = (
    <div className={styles.panel}>
      <div className={styles.tipHeader}>Cross-signal regime</div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={bs.tone} />
        <div>
          <div className={styles.tipPair}>Basis × 25Δ Skew</div>
          <div className={styles.tipNow}>{bs.label}</div>
        </div>
      </div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={biv.tone} />
        <div>
          <div className={styles.tipPair}>Basis × IV Δ1d</div>
          <div className={styles.tipNow}>{biv.label}</div>
        </div>
      </div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={bpc.tone} />
        <div>
          <div className={styles.tipPair}>Basis × P/C OI</div>
          <div className={styles.tipNow}>{bpc.label}</div>
        </div>
      </div>

      <div className={styles.tipDivider} />

      <div>
        <div className={styles.tipMatrixTitle}>Reading the matrix</div>
        <ul className={styles.tipList}>
          <li>
            <strong>+Basis / −Skew</strong> — fragile rally (longs leveraged & hedging)
          </li>
          <li>
            <strong>−Basis / +Skew</strong> — washed-out shorts, often a turn signal
          </li>
          <li>
            <strong>−Basis / +IV Δ</strong> — active panic
          </li>
          <li>
            <strong>−Basis / flat IV</strong> — passive deleveraging, less alarming
          </li>
          <li>
            <strong>+Basis / high P/C rising</strong> — hedged grind higher
          </li>
          <li>
            <strong>−Basis / low P/C</strong> — directional shorts, squeeze setup
          </li>
        </ul>
        <div className={styles.tipLegend}>
          <span className={styles.tipBadge} data-tone="bull" /> bullish
          <span className={styles.tipBadge} data-tone="mixed" /> mixed
          <span className={styles.tipBadge} data-tone="bear" /> bearish
          <span className={styles.tipBadge} data-tone="neutral" /> neutral
        </div>
      </div>
    </div>
  );

  return (
    <HoverTooltip
      as="div"
      className={styles.cell}
      placement="bottom-end"
      content={tooltipContent}
    >
      <span className={styles.label}>Regime</span>
      <div className={styles.dots}>
        <span className={styles.dot} data-tone={bs.tone} aria-label={`Basis × Skew: ${bs.label}`} />
        <span className={styles.dot} data-tone={biv.tone} aria-label={`Basis × IV Δ1d: ${biv.label}`} />
        <span className={styles.dot} data-tone={bpc.tone} aria-label={`Basis × P/C OI: ${bpc.label}`} />
      </div>
      <span className={styles.sub}>B×S · B×IV · B×OI</span>
    </HoverTooltip>
  );
}
