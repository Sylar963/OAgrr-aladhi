import { createContext, useContext } from 'react';

export const PanelDocumentContext = createContext<Document | null>(null);

export function usePanelDocument(): Document {
  return useContext(PanelDocumentContext) ?? document;
}

export function usePanelWindow(): Window {
  return usePanelDocument().defaultView ?? window;
}
