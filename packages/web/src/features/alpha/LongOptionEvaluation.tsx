import { useState } from 'react';
import type { AlphaLottoCandidate, AlphaPutCandidate } from '@oggregator/protocol';
import { useT } from '@lib/i18n';
import AlphaEvaluationPanel from './AlphaEvaluationPanel';
import { evaluationMessages } from './evaluation-messages';
import { longOptionEvaluationCandidate } from './evaluation-candidate';
import styles from './AlphaEvaluationPanel.module.css';

export default function LongOptionEvaluation({
  candidate,
  contracts,
  holdingQuantity = 0,
}: {
  candidate: AlphaLottoCandidate | AlphaPutCandidate;
  contracts?: number;
  holdingQuantity?: number;
}) {
  const t = useT(evaluationMessages);
  const [quantity, setQuantity] = useState(String(candidate.minQty));
  const amount = contracts ?? (quantity.trim() === '' ? NaN : Number(quantity));
  const snapshot =
    Number.isFinite(amount) && amount > 0
      ? longOptionEvaluationCandidate(candidate, amount, holdingQuantity)
      : null;
  return (
    <AlphaEvaluationPanel
      candidate={snapshot}
      quantityControl={
        contracts == null ? (
          <label className={styles.field}>
            {t('quantity')}
            <input
              type="number"
              min={candidate.minQty}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
        ) : undefined
      }
    />
  );
}
