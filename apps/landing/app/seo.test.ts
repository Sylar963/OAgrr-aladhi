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
    expect(entries[0]?.url).toContain('oggregator');
  });

  it('ships a dark manifest', () => {
    const result = manifest();
    expect(result.name).toBe('Oggregator');
    expect(result.background_color).toBe('#080b0d');
  });
});
