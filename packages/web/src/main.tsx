import { esMX } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/react';
import { AccountSessionProvider } from '@components/auth/AccountSessionProvider';
import ErrorBoundary from '@components/ui/ErrorBoundary';
import PopoutChartPage from '@features/chain/PopoutChartPage';
import { TradfiPopoutChartPage } from '@features/tradfi';
import { useLocale } from '@lib/i18n';
import { queryClient } from '@lib/query-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

const popoutSearch = new URLSearchParams(window.location.search);
const isPopout = popoutSearch.get('popout') === '1';
const isTradfiPopout = isPopout && popoutSearch.get('provider') === 'tradfi';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

function LocalizedClerkProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return (
    <ClerkProvider
      localization={locale === 'es' ? esMX : undefined}
      publishableKey={clerkPublishableKey}
      afterSignOutUrl="/"
      signInForceRedirectUrl={window.location.origin}
      signUpForceRedirectUrl={window.location.origin}
    >
      {children}
    </ClerkProvider>
  );
}

createRoot(root).render(
  <StrictMode>
    <LocalizedClerkProvider>
      <QueryClientProvider client={queryClient}>
        <AccountSessionProvider>
          <ErrorBoundary label={isPopout ? 'Chart popout' : 'Application'}>
            {isTradfiPopout ? <TradfiPopoutChartPage /> : isPopout ? <PopoutChartPage /> : <App />}
          </ErrorBoundary>
          <Analytics />
          <SpeedInsights />
          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        </AccountSessionProvider>
      </QueryClientProvider>
    </LocalizedClerkProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      void registration.unregister();
    }
  });
}
