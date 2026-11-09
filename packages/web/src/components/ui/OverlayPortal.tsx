import { type ReactNode, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanelDocument } from '@lib/panel-document';

// Older browsers make a size container the containing block for position: fixed, which would clip
// an overlay to its widget. Stays inside the TradFi root when present, for its theme tokens.
export default function OverlayPortal({ children }: { children: ReactNode }) {
  const ownerDocument = usePanelDocument();
  const [host] = useState(() => {
    const element = document.createElement('div');
    element.style.display = 'contents';
    return element;
  });

  // A stable portal container preserves form state when its window changes.
  useLayoutEffect(() => {
    const target = ownerDocument.querySelector('[data-mode="tradfi"]') ?? ownerDocument.body;
    target.appendChild(host);
    return () => host.remove();
  }, [host, ownerDocument]);

  return createPortal(children, host);
}
