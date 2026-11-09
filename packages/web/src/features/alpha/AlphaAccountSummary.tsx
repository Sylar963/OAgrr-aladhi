import { useState } from 'react';
import { ParadexAccountSummary, ThalexAccountSummary } from '@features/portfolio';
import { defineMessages, useT } from '@lib/i18n';
import styles from './AlphaAccountSummary.module.css';

const messages = defineMessages(
  {
    account: 'Account',
    thalex: 'Thalex account · all assets',
    paradex: 'Paradex account · all assets',
  },
  {
    account: 'Cuenta',
    thalex: 'Cuenta Thalex · todos los activos',
    paradex: 'Cuenta Paradex · todos los activos',
  },
);

export default function AlphaAccountSummary({
  defaultVenue,
  onUseEquity,
}: {
  defaultVenue: 'thalex' | 'paradex';
  onUseEquity?: (equity: number) => void;
}) {
  const t = useT(messages);
  const [venue, setVenue] = useState(defaultVenue);
  const Summary = venue === 'thalex' ? ThalexAccountSummary : ParadexAccountSummary;
  return (
    <Summary
      onUseEquity={onUseEquity}
      accountSelector={
        <label className={styles.selector}>
          <span>{t('account')}</span>
          <select
            value={venue}
            onChange={(event) => {
              if (event.target.value === 'thalex' || event.target.value === 'paradex') {
                setVenue(event.target.value);
              }
            }}
          >
            <option value="thalex">{t('thalex')}</option>
            <option value="paradex">{t('paradex')}</option>
          </select>
        </label>
      }
    />
  );
}
