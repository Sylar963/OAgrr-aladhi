import { focusManager, QueryClient, QueryCache } from '@tanstack/react-query';
import { isAppVisible, subscribeAppVisibility } from './app-visibility';

focusManager.setEventListener((onFocus) => subscribeAppVisibility(() => onFocus(isAppVisible())));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 5 * 60 * 1_000,
      retry: (failureCount, error) => {
        if ((error as { status?: number }).status === 401) return false;
        return failureCount < 3;
      },
      refetchOnWindowFocus: true,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.state.data !== undefined) {
        console.error('Background fetch failed:', error);
      }
    },
  }),
});
