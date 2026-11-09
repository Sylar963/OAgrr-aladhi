export const WORKSPACE_POPOUT_URL = '/workspace-popout.html';

export function syncPopoutDocument(source: Document, target: Document): () => void {
  // Dockview copies a CSS snapshot; lazy widgets can load more styles after the window opens.
  for (const node of target.head.querySelectorAll('style, link[rel="stylesheet"]')) node.remove();
  const copies = new Map<Element, Element>();
  const sync = () => {
    const styles = [...source.head.querySelectorAll('style, link[rel="stylesheet"]')];
    for (const [original, copy] of copies) {
      if (!styles.includes(original)) {
        copy.remove();
        copies.delete(original);
      }
    }
    for (const original of styles) {
      let copy = copies.get(original);
      if (!copy || !copy.isEqualNode(original)) {
        const next = original.cloneNode(true) as Element;
        copy?.replaceWith(next);
        copies.set(original, next);
        copy = next;
      }
      target.head.appendChild(copy);
    }
    for (const name of ['lang', 'class', 'style', 'data-theme']) {
      const value = source.documentElement.getAttribute(name);
      if (value == null) target.documentElement.removeAttribute(name);
      else target.documentElement.setAttribute(name, value);
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source.head, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
  observer.observe(source.documentElement, {
    attributes: true,
    attributeFilter: ['lang', 'class', 'style', 'data-theme'],
  });
  return () => observer.disconnect();
}
