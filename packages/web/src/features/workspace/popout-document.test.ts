import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncPopoutDocument } from './popout-document';

describe('syncPopoutDocument', () => {
  let stop = () => {};
  afterEach(() => stop());

  it('keeps lazy styles, stylesheet URLs and language in sync without copying scripts', async () => {
    const source = document.implementation.createHTMLDocument();
    const target = document.implementation.createHTMLDocument();
    source.documentElement.lang = 'en';
    source.head.innerHTML = '<style>.card { color: red; }</style><script>ignored</script>';
    target.head.innerHTML = '<style>.old { color: blue; }</style>';
    stop = syncPopoutDocument(source, target);
    expect(target.querySelectorAll('style')).toHaveLength(1);
    expect(target.querySelector('script')).toBeNull();

    const lazy = source.createElement('link');
    lazy.rel = 'stylesheet';
    lazy.href = '/assets/lazy-panel.css';
    source.head.appendChild(lazy);
    source.querySelector('style')!.textContent = '.card { color: green; }';
    source.documentElement.lang = 'es';
    await vi.waitFor(() => {
      expect(target.querySelector('link')?.getAttribute('href')).toBe('/assets/lazy-panel.css');
      expect(target.querySelector('style')?.textContent).toContain('green');
      expect(target.documentElement.lang).toBe('es');
    });
    lazy.remove();
    await vi.waitFor(() => expect(target.querySelector('link')).toBeNull());
  });

  it('stops observing a closed pop-out document', async () => {
    const source = document.implementation.createHTMLDocument();
    const target = document.implementation.createHTMLDocument();
    source.documentElement.lang = 'en';
    stop = syncPopoutDocument(source, target);
    stop();
    source.documentElement.lang = 'es';
    await Promise.resolve();
    expect(target.documentElement.lang).toBe('en');
  });
});
