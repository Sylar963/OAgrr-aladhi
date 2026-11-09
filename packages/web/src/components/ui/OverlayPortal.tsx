import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePanelDocument } from '@lib/panel-document';

// Older browsers make a size container the containing block for position: fixed, which would clip
// an overlay to its widget. Stays inside the TradFi root when present, for its theme tokens.
export default function OverlayPortal({ children }: { children: ReactNode }) {
  const ownerDocument = usePanelDocument();
  return createPortal(
    children,
    ownerDocument.querySelector('[data-mode="tradfi"]') ?? ownerDocument.body,
  );
}
