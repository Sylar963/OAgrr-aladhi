import { useAuth } from '@clerk/clerk-react';
import { setClerkTokenGetter } from '@lib/clerk-token';
import { useEffect } from 'react';

/** Registers Clerk's getToken into the module-level getter used by fetch helpers. */
export default function ClerkTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setClerkTokenGetter(() => getToken());
    return () => setClerkTokenGetter(null);
  }, [getToken]);
  return null;
}
