import HoverTooltip from '@components/ui/HoverTooltip';
import { defineMessages, useT } from '@lib/i18n';
import styles from './RegimeChip.module.css';

type Tone = 'bull' | 'bear' | 'mixed' | 'neutral' | 'unknown';

const messages = defineMessages(
  {
    noSkew: 'No skew data',
    flatCarryOrSkew: 'Flat carry or flat skew',
    contangoCallSkew: 'Contango + call-skew bid',
    contangoPutSkew: 'Contango + put-skew premium',
    backwardationCallSkew: 'Backwardation + call-skew bid',
    backwardationPutSkew: 'Backwardation + put-skew premium',
    noIv: 'No IV Δ data',
    flatCarry: 'Flat carry',
    backwardationIvExpanding: 'Backwardation + IV expanding',
    backwardationIvCalming: 'Backwardation + IV calming',
    contangoIvBleeding: 'Contango + IV bleeding',
    contangoIvExpanding: 'Contango + IV expanding',
    noPc: 'No P/C data',
    backwardationCallOi: 'Backwardation + call-heavy OI',
    contangoPutOi: 'Contango + put-heavy OI',
    contangoCallOi: 'Contango + call-heavy OI',
    backwardationPutOi: 'Backwardation + put-heavy OI',
    balancedOi: 'Balanced OI',
    header: 'Cross-signal regime',
    heuristics: 'Common heuristic reads',
    readFragile: 'contango with crash premium → often called fragile rally',
    readTurn: 'backwardation with calls bid → often called turn / squeeze',
    readPanic: 'backwardation + IV expanding → active panic',
    readDeleveraging: 'backwardation + IV calming → passive deleveraging',
    readAligned: 'aligned bullish positioning',
    readSqueezeFuel: 'backwardation w/ no put demand → squeeze fuel',
    readCapitulation: 'stress + downside hedged → capitulation watch',
    callHeavyOi: 'call-heavy OI',
    putHeavyOi: 'put-heavy OI',
    flatIv: 'flat IV',
    bullish: 'bullish',
    mixed: 'mixed',
    bearish: 'bearish',
    neutral: 'neutral',
    caveat:
      'Heuristic reads from cost-of-carry theory, skew/IV literature (Bates, Black), and crypto practitioner frameworks (Deribit Insights, Block Scholes, Genesis Vol). Not investment signals — interpretation flips with retail vs. institutional flow.',
    regime: 'Regime',
  },
  {
    noSkew: 'Sin datos de skew',
    flatCarryOrSkew: 'Carry plano o skew plano',
    contangoCallSkew: 'Contango + skew de calls con demanda',
    contangoPutSkew: 'Contango + prima en skew de puts',
    backwardationCallSkew: 'Backwardation + skew de calls con demanda',
    backwardationPutSkew: 'Backwardation + prima en skew de puts',
    noIv: 'Sin datos de IV Δ',
    flatCarry: 'Carry plano',
    backwardationIvExpanding: 'Backwardation + IV en expansión',
    backwardationIvCalming: 'Backwardation + IV calmándose',
    contangoIvBleeding: 'Contango + IV cediendo',
    contangoIvExpanding: 'Contango + IV en expansión',
    noPc: 'Sin datos de P/C',
    backwardationCallOi: 'Backwardation + OI cargado a calls',
    contangoPutOi: 'Contango + OI cargado a puts',
    contangoCallOi: 'Contango + OI cargado a calls',
    backwardationPutOi: 'Backwardation + OI cargado a puts',
    balancedOi: 'OI equilibrado',
    header: 'Régimen de señales cruzadas',
    heuristics: 'Lecturas heurísticas comunes',
    readFragile: 'contango con prima de crash → suele llamarse rally frágil',
    readTurn: 'backwardation con demanda de calls → suele llamarse giro / squeeze',
    readPanic: 'backwardation + IV en expansión → pánico activo',
    readDeleveraging: 'backwardation + IV calmándose → desapalancamiento pasivo',
    readAligned: 'posicionamiento alcista alineado',
    readSqueezeFuel: 'backwardation sin demanda de puts → combustible para squeeze',
    readCapitulation: 'estrés + cobertura bajista → vigilar capitulación',
    callHeavyOi: 'OI cargado a calls',
    putHeavyOi: 'OI cargado a puts',
    flatIv: 'IV plana',
    bullish: 'alcista',
    mixed: 'mixto',
    bearish: 'bajista',
    neutral: 'neutral',
    caveat:
      'Lecturas heurísticas basadas en la teoría de costo de carry, literatura de skew/IV (Bates, Black) y marcos de traders cripto (Deribit Insights, Block Scholes, Genesis Vol). No son señales de inversión — la interpretación se invierte según el flujo minorista vs. institucional.',
    regime: 'Régimen',
  },
);

type LabelKey = keyof typeof messages.en;

interface RegimeChipProps {
  basisPct: number | null;
  skew25d: number | null;
  ivChange1d: number | null | undefined;
  putCallOiRatio: number | null;
  // Venues with no day-over-day IV feed (e.g. TradFi, which has no DVOL
  // equivalent) hide the Basis × IV dot rather than show a permanent
  // "No IV Δ data" placeholder. Default true keeps the crypto chain unchanged.
  showIvSignal?: boolean;
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

// Labels describe what's measured (basis sign, skew sign, IV change sign, P/C
// bucket). Tones reflect commonly cited practitioner regimes from skew/IV
// literature and trader frameworks — they are heuristics, not signals. See
// tooltip footer for sourcing.

function basisSkewTone(b: Sign3 | null, s: Sign3 | null): { tone: Tone; label: LabelKey } {
  if (!b || !s) return { tone: 'unknown', label: 'noSkew' };
  if (b === 'flat' || s === 'flat') return { tone: 'neutral', label: 'flatCarryOrSkew' };
  if (b === 'pos' && s === 'pos') return { tone: 'bull', label: 'contangoCallSkew' };
  if (b === 'pos' && s === 'neg') return { tone: 'mixed', label: 'contangoPutSkew' };
  if (b === 'neg' && s === 'pos') return { tone: 'bull', label: 'backwardationCallSkew' };
  return { tone: 'bear', label: 'backwardationPutSkew' };
}

function basisIvTone(b: Sign3 | null, iv: Sign3 | null): { tone: Tone; label: LabelKey } {
  if (!b || !iv) return { tone: 'unknown', label: 'noIv' };
  if (b === 'flat') return { tone: 'neutral', label: 'flatCarry' };
  if (b === 'neg' && iv === 'pos') return { tone: 'bear', label: 'backwardationIvExpanding' };
  if (b === 'neg' && (iv === 'neg' || iv === 'flat'))
    return { tone: 'mixed', label: 'backwardationIvCalming' };
  if (b === 'pos' && (iv === 'neg' || iv === 'flat'))
    return { tone: 'bull', label: 'contangoIvBleeding' };
  return { tone: 'mixed', label: 'contangoIvExpanding' };
}

function basisPcTone(b: Sign3 | null, pc: PcBucket | null): { tone: Tone; label: LabelKey } {
  if (!b || !pc) return { tone: 'unknown', label: 'noPc' };
  if (b === 'flat') return { tone: 'neutral', label: 'flatCarry' };
  if (b === 'neg' && pc === 'low') return { tone: 'bull', label: 'backwardationCallOi' };
  if (b === 'pos' && pc === 'high') return { tone: 'bull', label: 'contangoPutOi' };
  if (b === 'pos' && pc === 'low') return { tone: 'bull', label: 'contangoCallOi' };
  if (b === 'neg' && pc === 'high') return { tone: 'bear', label: 'backwardationPutOi' };
  return { tone: 'neutral', label: 'balancedOi' };
}

export default function RegimeChip({
  basisPct,
  skew25d,
  ivChange1d,
  putCallOiRatio,
  showIvSignal = true,
}: RegimeChipProps) {
  const t = useT(messages);
  const b = sign(basisPct, BASIS_FLAT);
  const s = sign(skew25d, SKEW_FLAT);
  const iv = sign(ivChange1d, IV_FLAT);
  const pc = pcBucket(putCallOiRatio);

  const bs = basisSkewTone(b, s);
  const biv = basisIvTone(b, iv);
  const bpc = basisPcTone(b, pc);

  const tooltipContent = (
    <div className={styles.panel}>
      <div className={styles.tipHeader}>{t('header')}</div>

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={bs.tone} />
        <div>
          <div className={styles.tipPair}>Basis × 25Δ Skew</div>
          <div className={styles.tipNow}>{t(bs.label)}</div>
        </div>
      </div>

      {showIvSignal && (
        <div className={styles.tipRow}>
          <span className={styles.tipBadge} data-tone={biv.tone} />
          <div>
            <div className={styles.tipPair}>Basis × IV Δ1d</div>
            <div className={styles.tipNow}>{t(biv.label)}</div>
          </div>
        </div>
      )}

      <div className={styles.tipRow}>
        <span className={styles.tipBadge} data-tone={bpc.tone} />
        <div>
          <div className={styles.tipPair}>Basis × P/C OI</div>
          <div className={styles.tipNow}>{t(bpc.label)}</div>
        </div>
      </div>

      <div className={styles.tipDivider} />

      <div>
        <div className={styles.tipMatrixTitle}>{t('heuristics')}</div>
        <ul className={styles.tipList}>
          <li>
            <strong>+B / −Skew</strong> — {t('readFragile')}
          </li>
          <li>
            <strong>−B / +Skew</strong> — {t('readTurn')}
          </li>
          <li>
            <strong>−B / +IV Δ</strong> — {t('readPanic')}
          </li>
          <li>
            <strong>−B / {t('flatIv')}</strong> — {t('readDeleveraging')}
          </li>
          <li>
            <strong>+B / {t('callHeavyOi')}</strong> — {t('readAligned')}
          </li>
          <li>
            <strong>−B / {t('callHeavyOi')}</strong> — {t('readSqueezeFuel')}
          </li>
          <li>
            <strong>−B / {t('putHeavyOi')}</strong> — {t('readCapitulation')}
          </li>
        </ul>
        <div className={styles.tipLegend}>
          <span className={styles.tipBadge} data-tone="bull" /> {t('bullish')}
          <span className={styles.tipBadge} data-tone="mixed" /> {t('mixed')}
          <span className={styles.tipBadge} data-tone="bear" /> {t('bearish')}
          <span className={styles.tipBadge} data-tone="neutral" /> {t('neutral')}
        </div>
        <div className={styles.tipCaveat}>
          {t('caveat')}
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
      <span className={styles.label}>{t('regime')}</span>
      <div className={styles.dots}>
        <span className={styles.dot} data-tone={bs.tone} aria-label={`Basis × Skew: ${t(bs.label)}`} />
        {showIvSignal && (
          <span
            className={styles.dot}
            data-tone={biv.tone}
            aria-label={`Basis × IV Δ1d: ${t(biv.label)}`}
          />
        )}
        <span className={styles.dot} data-tone={bpc.tone} aria-label={`Basis × P/C OI: ${t(bpc.label)}`} />
      </div>
      <span className={styles.sub}>{showIvSignal ? 'B×S · B×IV · B×OI' : 'B×S · B×OI'}</span>
    </HoverTooltip>
  );
}
