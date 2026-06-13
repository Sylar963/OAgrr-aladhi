import { render, screen } from '@testing-library/react';

import { Footer } from './Footer';

describe('Footer', () => {
  it('renders nav anchors and the copyright line', () => {
    render(<Footer />);

    expect(screen.getByRole('link', { name: /^terminal$/i })).toHaveAttribute(
      'href',
      '#showcase',
    );
    expect(screen.getByRole('link', { name: /^access$/i })).toHaveAttribute('href', '#access');
    expect(screen.getByText(/©\s*\d{4}\s*Oggregator/i)).toBeInTheDocument();
  });
});
