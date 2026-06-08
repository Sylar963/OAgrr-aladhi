type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;

/** Registered once by a component rendered inside <ClerkProvider>. */
export function setClerkTokenGetter(fn: TokenGetter | null): void {
  getter = fn;
}

/** Returns a fresh Clerk session token, or null when signed out / not ready. */
export async function getClerkToken(): Promise<string | null> {
  if (!getter) return null;
  try {
    return await getter();
  } catch {
    return null;
  }
}
