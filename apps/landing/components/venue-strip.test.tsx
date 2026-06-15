import { render, screen } from '@testing-library/react';

import { venues } from '@/lib/demo-data';
import { VenueStrip } from './VenueStrip';

describe('VenueStrip', () => {
  it('renders one logo per venue from explicit logo paths', () => {
    render(<VenueStrip />);

    expect(venues).toHaveLength(8);
    for (const venue of venues) {
      expect(screen.getByAltText(venue.name)).toHaveAttribute('src', venue.logo);
    }
  });
});
