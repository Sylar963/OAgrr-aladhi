import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Oggregator',
    short_name: 'Oggregator',
    description: 'Cross-venue options aggregation terminal.',
    start_url: '/',
    display: 'browser',
    background_color: '#080b0d',
    theme_color: '#080b0d',
  };
}
