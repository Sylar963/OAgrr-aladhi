import { createContext, useCallback, useContext } from 'react';
import { usePanelDocument } from '@lib/panel-document';

export const PaletteContext = createContext<(ownerDocument?: Document) => void>(() => {});

export function useOpenPalette() {
  const open = useContext(PaletteContext);
  const ownerDocument = usePanelDocument();
  return useCallback(() => open(ownerDocument), [open, ownerDocument]);
}
