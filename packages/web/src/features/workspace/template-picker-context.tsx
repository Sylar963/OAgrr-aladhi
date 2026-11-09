import { useIsMobile } from '@hooks/useIsMobile';
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

const TemplatePicker = lazy(() => import('./TemplatePicker'));
const TemplatePickerContext = createContext<(tabId?: string) => void>(() => {});

export function useWorkspaceTemplates() {
  return useContext(TemplatePickerContext);
}

export function WorkspaceTemplatesProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<{ tabId?: string } | null>(null);
  const isMobile = useIsMobile();
  const open = useCallback((tabId?: string) => setTarget({ tabId }), []);
  const close = useCallback(() => setTarget(null), []);

  useEffect(() => {
    if (isMobile) close();
  }, [isMobile, close]);

  return (
    <TemplatePickerContext.Provider value={open}>
      {children}
      {target && !isMobile && (
        <Suspense fallback={null}>
          <TemplatePicker targetTabId={target.tabId} onClose={close} />
        </Suspense>
      )}
    </TemplatePickerContext.Provider>
  );
}
