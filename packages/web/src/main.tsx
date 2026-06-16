import { ClerkProvider } from '@clerk/clerk-react';
import ClerkTokenBridge from '@components/auth/ClerkTokenBridge';
import ErrorBoundary from '@components/ui/ErrorBoundary';
import PopoutChartPage from '@features/chain/PopoutChartPage';
import { TradfiPopoutChartPage } from '@features/tradfi';
import { queryClient } from '@lib/query-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

const popoutSearch = new URLSearchParams(window.location.search);
const isPopout = popoutSearch.get('popout') === '1';
const isTradfiPopout = isPopout && popoutSearch.get('provider') === 'tradfi';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

createRoot(root).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ClerkTokenBridge />
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary label={isPopout ? 'Chart popout' : 'Application'}>
          {isTradfiPopout ? <TradfiPopoutChartPage /> : isPopout ? <PopoutChartPage /> : <App />}
        </ErrorBoundary>
        <Analytics />
        <SpeedInsights />
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </ClerkProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}
