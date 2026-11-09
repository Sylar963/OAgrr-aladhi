const popoutDocuments = new Set<Document>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function isAppVisible(): boolean {
  return !document.hidden || [...popoutDocuments].some((target) => !target.hidden);
}

export function subscribeAppVisibility(listener: () => void): () => void {
  if (listeners.size === 0) document.addEventListener('visibilitychange', notify);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) document.removeEventListener('visibilitychange', notify);
  };
}

export function registerAppDocument(target: Document): () => void {
  popoutDocuments.add(target);
  target.addEventListener('visibilitychange', notify);
  notify();
  return () => {
    target.removeEventListener('visibilitychange', notify);
    popoutDocuments.delete(target);
    notify();
  };
}
