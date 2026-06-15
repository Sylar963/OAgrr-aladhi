import { render, screen } from '@testing-library/react';

import { LandingHeader } from './LandingHeader';

describe('LandingHeader', () => {
  it('offers a mobile menu with the section links', () => {
    render(<LandingHeader />);

    expect(screen.getByText(/^menu$/i)).toBeInTheDocument();
    // Desktop + mobile nav both exist in the DOM (CSS hides one per breakpoint).
    expect(screen.getAllByRole('link', { name: /^terminal$/i }).length).toBeGreaterThan(1);
    expect(screen.getAllByRole('link', { name: /^faq$/i }).length).toBeGreaterThan(1);
  });
});
