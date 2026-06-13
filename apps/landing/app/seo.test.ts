import manifest from './manifest';
import robots from './robots';
import sitemap from './sitemap';

describe('SEO route files', () => {
  it('allows crawling and points at the sitemap', () => {
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it('lists the landing root in the sitemap', () => {
    const entries = sitemap();
    const url = entries[0]?.url;
    expect(url).toBeDefined();
    // Validate it's a real absolute URL rather than matching a hardcoded hostname.
    expect(() => new URL(String(url))).not.toThrow();
  });

  it('ships a dark manifest', () => {
    const result = manifest();
    expect(result.name).toBe('Oggregator');
    expect(result.background_color).toBe('#080b0d');
  });
});
