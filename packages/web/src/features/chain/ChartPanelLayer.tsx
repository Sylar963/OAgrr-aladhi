import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '@hooks/useIsMobile';
import { useChartPanelsStore } from './chart-panels-store.js';
import MobileChartModal from './MobileChartModal.js';

export default function ChartPanelLayer() {
  const panels = useChartPanelsStore((s) => s.panels);
  const isMobile = useIsMobile();
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    let element = document.getElementById('chart-panel-layer');
    let owned = false;
    if (!element) {
      element = document.createElement('div');
      element.id = 'chart-panel-layer';
      document.body.appendChild(element);
      owned = true;
    }
    setHost(element);
    return () => {
      if (owned && element?.parentNode) element.parentNode.removeChild(element);
    };
  }, []);

  if (!host || !isMobile) return null;
  return createPortal(
    <>{panels.map((p) => <MobileChartModal key={p.id} panel={p} />)}</>,
    host,
  );
}
