import { deltaColor, deltaLabel } from '@lib/colors';
import { defineMessages, useT } from '@lib/i18n';
import styles from './DeltaToggleLegend.module.css';

interface Props {
  deltas: readonly number[];
  enabled: Set<number>;
  onToggle: (delta: number) => void;
  onSetAll: (next: Set<number>) => void;
}

const messages = defineMessages({ all: 'All', none: 'None' }, { all: 'Todos', none: 'Ninguno' });

export const PRESET_25D = new Set<number>([0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]);

export function preset25Deltas(deltas: readonly number[]): Set<number> {
  return new Set(deltas.filter((d) => PRESET_25D.has(round2(d))));
}

export default function DeltaToggleLegend({ deltas, enabled, onToggle, onSetAll }: Props) {
  const t = useT(messages);
  const allOn = () => onSetAll(new Set(deltas));
  const allOff = () => onSetAll(new Set());
  const preset25 = () => onSetAll(preset25Deltas(deltas));

  return (
    <div className={styles.rail}>
      <div className={styles.presets}>
        <button type="button" className={styles.presetBtn} onClick={allOn}>{t('all')}</button>
        <button type="button" className={styles.presetBtn} onClick={allOff}>{t('none')}</button>
        <button type="button" className={styles.presetBtn} onClick={preset25}>25Δ</button>
      </div>

      <ul className={styles.list}>
        {deltas.map((d) => {
          const active = enabled.has(d);
          const isAtm = Math.abs(d - 0.5) < 1e-6;
          return (
            <li key={d}>
              <label className={styles.row}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={active}
                  onChange={() => onToggle(d)}
                />
                <span className={styles.swatch} style={{ background: deltaColor(d) }} />
                <span className={isAtm ? styles.labelAtm : styles.label}>{deltaLabel(d)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
