import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import { HeroTerminalSection } from './HeroTerminalSection';

describe('HeroTerminalSection (reduced motion)', () => {
  it('renders the pitch scene with a visible h1 and CTAs', () => {
    render(<HeroTerminalSection />);

    expect(
      screen.getByRole('heading', { level: 1, name: /one terminal\. every venue\./i }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /request access/i })).toBeVisible();
    expect(screen.queryByText(/not a screenshot/i)).not.toBeInTheDocument();
  });
});
