import { ErrorBoundary, Spinner } from '@components/ui';
import { defineMessages, useT } from '@lib/i18n';
import { lazy, Suspense } from 'react';

const DockHost = lazy(() => import('./DockHost'));

const messages = defineMessages({ label: 'This tab' }, { label: 'Esta pestaña' });

export default function CustomTabView({ tabId }: { tabId: string }) {
  const t = useT(messages);
  return (
    <ErrorBoundary label={t('label')}>
      <Suspense fallback={<Spinner size="lg" />}>
        <DockHost tabId={tabId} />
      </Suspense>
    </ErrorBoundary>
  );
}
