const MIN_HIDDEN_MS = 15_000;

/**
 * Calls `listener` when a socket opened earlier can no longer be trusted: the page was hidden long
 * enough for the OS to drop it, the network came back, or the page returned from the back/forward
 * cache. A phone can kill a backgrounded socket without a close event, so it still reads as OPEN
 * and no reconnect ever starts.
 */
export function onConnectionResume(listener: () => void): () => void {
  let hiddenAt = document.hidden ? Date.now() : null;

  const onVisibilityChange = () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const hiddenSince = hiddenAt;
    hiddenAt = null;
    if (hiddenSince != null && Date.now() - hiddenSince >= MIN_HIDDEN_MS) listener();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) listener();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', listener);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', listener);
    window.removeEventListener('pageshow', onPageShow);
  };
}
