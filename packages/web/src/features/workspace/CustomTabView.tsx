import { ErrorBoundary, Spinner } from '@components/ui';
import { lazy, Suspense } from 'react';

const DockHost = lazy(() => import('./DockHost'));

export default function CustomTabView({ tabId }: { tabId: string }) {
  return (
    <ErrorBoundary key={tabId} label={tabId}>
      <Suspense fallback={<Spinner size="lg" />}>
        <DockHost tabId={tabId} />
      </Suspense>
    </ErrorBoundary>
  );
}
