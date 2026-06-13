import { render, screen } from '@testing-library/react';

import { TrustSection } from './TrustSection';

describe('TrustSection', () => {
  it('renders verifiable engineering claims and a contact path', () => {
    render(<TrustSection />);

    expect(screen.getByRole('heading', { name: /built to be checked/i })).toBeInTheDocument();
    expect(screen.getByText(/degraded shows as degraded/i)).toBeInTheDocument();
    expect(screen.getByText(/venue-tagged/i)).toBeInTheDocument();
    // No fabricated metrics, no anonymous quotes.
    expect(screen.queryByText(/99\.9/)).not.toBeInTheDocument();
    // Contact path exists either as mailto (env set) or as the #access fallback.
    expect(screen.getByRole('link', { name: /request access below|@/i })).toBeInTheDocument();
  });
});
