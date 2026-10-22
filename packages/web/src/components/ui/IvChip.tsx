import { ivLevel, ivColor } from '@lib/colors';
import { fmtIv } from '@lib/format';
import { defineMessages, useT } from '@lib/i18n';

import styles from './IvChip.module.css';

const messages = defineMessages({ noIv: 'No IV data' }, { noIv: 'Sin datos de IV' });

interface IvChipProps {
  iv: number | null;
  size?: 'sm' | 'md';
}

export default function IvChip({ iv, size = 'md' }: IvChipProps) {
  const t = useT(messages);
  const level = ivLevel(iv);
  const color = ivColor(level);

  return (
    <span
      className={styles.chip}
      data-size={size}
      style={{ color, borderColor: `${color}33`, background: `${color}14` }}
      title={iv != null ? `IV: ${(iv * 100).toFixed(2)}%` : t('noIv')}
    >
      {fmtIv(iv)}
    </span>
  );
}
