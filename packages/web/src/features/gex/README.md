# GEX live chart: heatmap and profile outline

The Bands chart uses spot candles with an ATR channel and the latest modeled
net-gamma profile. The Gamma history mode is retired as of 2026-11-17.

| Control or visual | Meaning |
| --- | --- |
| ATR channel | EMA plus/minus the chosen Wilder ATR multiple; existing lengths and presets remain available. |
| Heatmap | Green/red shows positive/negative modeled net gamma at simulated spot prices. Brightness scales with absolute magnitude. |
| Heatmap opacity | Changes background visibility without changing gamma values or the magnitude scale. |
| Profile outline | A sideways dashed curve. Farther left from its right-edge baseline means larger absolute net gamma. |
| Hover or tap | Reports the interpolated signed net gamma at the selected price, in $M per 1% move. |
| Levels | Shows current gamma walls and the flip without the heatmap or profile outline. |

## Read the profile

1. Use price on the vertical axis to find the region of interest.
2. Read the heatmap hue for the sign and brightness for magnitude.
3. Follow the white outline to compare magnitudes within the visible price range.
   Peaks extend left; zero crossings return to the right-edge baseline.
4. Hover or tap for the signed amount. The profile's horizontal displacement
   encodes magnitude, not a future timestamp or a forecast of when price reaches a level.

Outline width is proportional to `abs(net gamma) / maximum visible abs(net gamma)`.
Both signs share that visible maximum. Clipped viewport boundaries are interpolated,
and zero crossings are inserted before plotting absolute magnitude. The renderer
preserves multiple peaks and does not fit a Gaussian or extrapolate beyond the model grid.
Changing the visible price range rescales the outline. Heatmap colors continue to use
one shared maximum over the full profile, independently of the outline's scaling.

The profile uses the selected venues and expiries, holding IV and inferred positions
fixed. Values are current model scenarios across prices, not historical observations.

## Gamma history retirement

The chart no longer offers Gamma history, requests `/api/gex-wall-history`, or draws
the smoothed historical wall channel. The shared chart primitive accepts current
walls and the last candle anchor only. TradFi's existing live-level chart uses the
same updated primitive interface.

Stored wall snapshots, recording services, the history API, and legacy wall-channel
calculation utilities remain intact. Retiring this chart mode does not delete data
or change the gamma model, ATR calculation, or execution behavior.
