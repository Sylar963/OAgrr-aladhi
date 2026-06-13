import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';

import HomePage from './page';

afterEach(() => {
  cleanup();
});

describe('landing page', () => {
  it('renders the app-like landing architecture', async () => {
    render(await HomePage());

    expect(
      screen.getByRole('heading', {
        name: /one terminal\. every venue\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /surface\. chain\. portfolio\./i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: /answers before the call/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /request access/i }).length).toBeGreaterThan(0);
  });

  it('embeds FAQPage and Organization JSON-LD', async () => {
    const { container } = render(await HomePage());

    const scripts = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
    ).map((node) => JSON.parse(node.textContent ?? '{}'));

    expect(scripts.some((s) => s['@type'] === 'FAQPage')).toBe(true);
    expect(scripts.some((s) => s['@type'] === 'Organization')).toBe(true);
  });

  it('exposes banner/main/contentinfo landmarks and a skip link', async () => {
    render(await HomePage());

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to content/i })).toHaveAttribute(
      'href',
      '#main',
    );
  });
});
