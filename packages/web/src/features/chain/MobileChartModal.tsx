import type { ChartPanel } from './chart-panels-store.js';
import { useChartPanelsStore } from './chart-panels-store.js';
import { ChartPanelView } from './ChartPanelView.js';
import styles from './MobileChartModal.module.css';

export default function MobileChartModal({ panel }: { panel: ChartPanel }) {
  const update = useChartPanelsStore((s) => s.updatePanel);
  const close = useChartPanelsStore((s) => s.closePanel);
  const openPanel = useChartPanelsStore((s) => s.openPanel);

  const { id, ...data } = panel;

  return (
    <div className={styles.modal}>
      <ChartPanelView
        data={data}
        styles={styles}
        onPatch={(patch) => update(id, patch)}
        onSwitchVenue={(newVenue, newSymbol) => {
          // Panel id is keyed on venue+symbol, so a venue switch is modeled
          // as close + reopen rather than an in-place update.
          close(id);
          openPanel({
            venue: newVenue,
            symbol: newSymbol,
            underlying: panel.underlying,
            expiry: panel.expiry,
            strike: panel.strike,
            type: panel.type,
          });
        }}
        onClose={() => close(id)}
      />
    </div>
  );
}
