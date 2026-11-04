type TokenGetter = () => Promise<string | null>;

// Clerk's getter never settles when Clerk fails to load, and every REST call awaits this token, so
// an unbounded wait would freeze public market data along with the account features.
const TOKEN_WAIT_MS = 2_000;

let getter: TokenGetter | null = null;
let stalled = false;

/** Registered once by a component rendered inside <ClerkProvider>. */
export function setClerkTokenGetter(fn: TokenGetter | null): void {
  getter = fn;
  stalled = false;
}

/** Returns a fresh Clerk session token, or null when signed out / not ready. */
export async function getClerkToken(): Promise<string | null> {
  if (!getter) return null;
  const token = getter().then(
    (value) => {
      stalled = false;
      return value;
    },
    () => null,
  );
  // Once Clerk has stalled, later calls skip the wait instead of each paying it again.
  if (stalled) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      stalled = true;
      resolve(null);
    }, TOKEN_WAIT_MS);
  });
  try {
    return await Promise.race([token, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
