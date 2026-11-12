import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('Radar settings compatibility', () => {
  it('adds chart defaults to existing saved panels without losing their controls', async () => {
    localStorage.setItem(
      'ogg.expectedMovePanels.v1',
      JSON.stringify({
        'builtin-chain': {
          asset: 'ETH',
          venue: 'thalex',
          anchor: 'utc8',
          showStraddle: true,
          premiumAlertPercent: 15,
        },
      }),
    );
    const { useExpectedMoveSettings } = await import('./settings');
    const panel = useExpectedMoveSettings.getState().panels['builtin-chain'];
    expect(panel).toMatchObject({
      asset: 'ETH',
      venue: 'thalex',
      anchor: 'utc8',
      showStraddle: true,
      premiumAlertPercent: 15,
      horizon: 'day',
      chartUnit: 'price',
      showTwoSigma: false,
      showLiveCone: false,
    });
  });

  it('quarantines invalid settings per panel and rejects invalid new values', async () => {
    localStorage.setItem(
      'ogg.expectedMovePanels.v1',
      JSON.stringify({ valid: { asset: 'BTC' }, invalid: { chartUnit: 'watts' } }),
    );
    const { useExpectedMoveSettings } = await import('./settings');
    expect(useExpectedMoveSettings.getState().panels.valid).toBeDefined();
    expect(useExpectedMoveSettings.getState().panels.invalid).toBeUndefined();
    useExpectedMoveSettings.getState().update('valid', { moveAlertRatio: NaN });
    expect(useExpectedMoveSettings.getState().panels.valid?.moveAlertRatio).toBe(1);
  });
});
