import { createContext, useContext } from 'react';
import { defineMessages, useT } from '@lib/i18n';
import AlphaEvaluationJournal from './AlphaEvaluationJournal';
import styles from './AlphaEvaluationPanel.module.css';

const V2Context = createContext(true);
export const AlphaV2Provider = V2Context.Provider;
export function useAlphaV2() {
  return useContext(V2Context);
}

const messages = defineMessages(
  {
    title: 'V2 · Scenario lab & journal (optional)',
    intro:
      'Market context above is automatic. V2 lets you test a specific idea with your own assumptions.',
    one: 'Choose a candidate and size using the existing strategy controls.',
    two: 'Open “Evaluate this trade” below that candidate. Enter costs and your optional expiry distribution.',
    three:
      'Evaluate to freeze the quotes. The results depend on your assumptions; they do not change the automatic market verdict.',
    four: 'Save the snapshot, record an outcome later, and export the journal for backup.',
  },
  {
    title: 'V2 · Laboratorio de escenarios y diario (opcional)',
    intro:
      'El contexto de mercado de arriba es automático. V2 permite probar una idea específica con tus propios supuestos.',
    one: 'Elige candidato y tamaño con los controles existentes de la estrategia.',
    two: 'Abre «Evaluar este trade» debajo del candidato. Ingresa costos y, opcionalmente, tu distribución al vencimiento.',
    three:
      'Evalúa para congelar las cotizaciones. Los resultados dependen de tus supuestos y no cambian el veredicto automático.',
    four: 'Guarda la captura, registra el resultado después y exporta el diario para respaldo.',
  },
);

export default function AlphaV2Section({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const t = useT(messages);
  return (
    <details
      className={styles.panel}
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
    >
      <summary>{t('title')}</summary>
      <div className={styles.body}>
        <p>{t('intro')}</p>
        <ol>
          {(['one', 'two', 'three', 'four'] as const).map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
        {open && <AlphaEvaluationJournal />}
      </div>
    </details>
  );
}
