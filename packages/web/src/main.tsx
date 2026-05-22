import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import ErrorBoundary from '@components/ui/ErrorBoundary';
import { queryClient } from '@lib/query-client';
import App from './App';
import PopoutChartPage from '@features/chain/PopoutChartPage';

import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

const isPopout = new URLSearchParams(window.location.search).get('popout') === '1';

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary label={isPopout ? 'Chart popout' : 'Application'}>
        {isPopout ? <PopoutChartPage /> : <App />}
      </ErrorBoundary>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}
