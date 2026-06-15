import { useAppStore } from '@stores/app-store';
import { useOpenPalette } from '@components/layout/palette-context';
import { getTokenLogo, getUnderlyingDisplayMeta } from '@lib/token-meta';
import { useUnderlyings } from '@features/chain/queries';

import styles from './AssetPickerButton.module.css';

export default function AssetPickerButton() {
  const underlying = useAppStore((s) => s.underlying);
  const { data: underlyingsData } = useUnderlyings();
  const underlyings = underlyingsData?.underlyings ?? [];
  const openPalette = useOpenPalette();
  const logo = getTokenLogo(underlying);
  const display = getUnderlyingDisplayMeta(underlying, underlyings);

  return (
    <button className={styles.btn} onClick={openPalette} title={display.sublabel}>
      {logo && <img src={logo} className={styles.logo} alt={underlying} />}
      <span className={styles.label}>{display.label}</span>
      <span className={styles.chevron}>▾</span>
    </button>
  );
}
