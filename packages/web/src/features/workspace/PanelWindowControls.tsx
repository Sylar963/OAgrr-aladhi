import { defineMessages, useT } from '@lib/i18n';
import { useMarket } from '@stores/app-store';
import { PaletteContext } from '@components/layout/palette-context';
import type { DockviewApi, IDockviewHeaderActionsProps } from 'dockview-react';
import { useContext, useState } from 'react';

import styles from './PanelWindowControls.module.css';

const messages = defineMessages(
  {
    popout: 'Pop out {panel}',
    popoutGroup: 'Pop out this group',
    dock: 'Dock back',
    linked: '{ticker} · Workspace',
    binding:
      'Change the shared workspace market. Panels with their own ticker controls keep their selection. Keep the main window open.',
  },
  {
    popout: 'Abrir {panel} en otra ventana',
    popoutGroup: 'Abrir este grupo en otra ventana',
    dock: 'Volver al espacio',
    linked: '{ticker} · Espacio',
    binding:
      'Cambia el mercado compartido. Los paneles con controles propios conservan su ticker. Mantén abierta la ventana principal.',
  },
);

export function dockPopoutWindow(api: DockviewApi, target: Window) {
  for (const group of api.groups) {
    if (group.api.location.type === 'popout' && group.api.getWindow() === target) {
      group.api.moveTo({ position: 'right' });
    }
  }
}

export default function PanelWindowControls({
  containerApi,
  activePanel,
  group,
  location,
}: IDockviewHeaderActionsProps) {
  const t = useT(messages);
  const ticker = useMarket((market) => market.underlying);
  const openPalette = useContext(PaletteContext);
  const [opening, setOpening] = useState(false);
  const poppedOut = location?.type === 'popout';

  const open = async (wholeGroup: boolean) => {
    if (opening || !activePanel) return;
    setOpening(true);
    try {
      await containerApi.addPopoutGroup(wholeGroup ? group : activePanel, {
        position: { left: window.screenX + 80, top: window.screenY + 80, width: 1100, height: 760 },
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className={styles.controls}>
      {poppedOut ? (
        <>
          <button
            type="button"
            className={`${styles.action} ${styles.binding}`}
            title={t('binding')}
            onClick={() => openPalette(group.api.getWindow().document)}
          >
            {t('linked', { ticker })}
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => dockPopoutWindow(containerApi, group.api.getWindow())}
            title={t('dock')}
          >
            <span aria-hidden="true">↙</span> {t('dock')}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={styles.action}
            aria-label={t('popout', { panel: activePanel?.title ?? '' })}
            title={t('popout', { panel: activePanel?.title ?? '' })}
            disabled={opening || !activePanel}
            onClick={() => void open(false)}
          >
            <span aria-hidden="true">↗</span>
          </button>
          {group.panels.length > 1 && (
            <button
              type="button"
              className={styles.action}
              aria-label={t('popoutGroup')}
              title={t('popoutGroup')}
              disabled={opening || !activePanel}
              onClick={() => void open(true)}
            >
              <span aria-hidden="true">▣↗</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
