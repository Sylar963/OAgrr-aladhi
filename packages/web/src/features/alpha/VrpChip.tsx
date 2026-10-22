import InfoTip from '@components/ui/InfoTip';
import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';

import styles from './VrpChip.module.css';

interface VrpChipProps {
  atmIv30d: number | null;
  rv30d: number | null;
  vrp30d: number | null;
}

const messages = defineMessages(
  {
    label: 'What is VRP?',
    title: 'Variance Risk Premium (30d)',
    definition:
      '. The premium option sellers earn for taking on tail risk vs. realized volatility.',
    pricing: '— what the market is pricing.',
    realized: '— what spot has actually realized.',
    regime:
      'Crypto VRP is structurally positive (~85% of observations). When VRP flips negative, IV is cheap relative to realized — selling premium here is paying you less than the underlying actually moves. Treat credit-spread setups with a healthy skepticism in that regime.',
  },
  {
    label: '¿Qué es el VRP?',
    title: 'Prima de riesgo de varianza (30d)',
    definition:
      '. La prima que ganan los vendedores de opciones por asumir riesgo de cola frente a la volatilidad realizada.',
    pricing: '— lo que el mercado está descontando.',
    realized: '— lo que el spot realmente ha realizado.',
    regime:
      'El VRP en cripto es estructuralmente positivo (~85% de las observaciones). Cuando el VRP se vuelve negativo, la IV está barata frente a la realizada: vender prima aquí te paga menos de lo que realmente se mueve el subyacente. Trata los setups de credit spread con un sano escepticismo en ese régimen.',
  },
);

type Tone = 'rich' | 'neutral' | 'cheap' | 'unknown';

const STRONG_THRESHOLD = 0.05;

function vrpTone(vrp: number | null): Tone {
  if (vrp == null) return 'unknown';
  if (vrp >= STRONG_THRESHOLD) return 'rich';
  if (vrp <= 0) return 'cheap';
  return 'neutral';
}

export default function VrpChip({ atmIv30d, rv30d, vrp30d }: VrpChipProps) {
  const t = useT(messages);
  const tone = vrpTone(vrp30d);
  const vrpDisplay = vrp30d == null ? '—' : `${(vrp30d * 100).toFixed(1)}pp`;

  return (
    <div className={styles.chip} data-tone={tone}>
      <span className={styles.label}>VRP30d</span>
      <span className={styles.value}>{vrpDisplay}</span>
      <InfoTip
        label={t('label')}
        title={t('title')}
        align="end"
      >
        <p>
          <strong>VRP30d = ATM IV30d − RV30d</strong>
          {t('definition')}
        </p>
        <ul style={{ margin: '6px 0 0', paddingLeft: 14 }}>
          <li>
            <strong>ATM IV30d:</strong> {fmtIv(atmIv30d)} {t('pricing')}
          </li>
          <li>
            <strong>RV30d:</strong> {fmtIv(rv30d)} {t('realized')}
          </li>
          <li>
            <strong>VRP30d:</strong> {vrpDisplay}.
          </li>
        </ul>
        <p style={{ marginTop: 6 }}>
          {t('regime')}
        </p>
      </InfoTip>
    </div>
  );
}
