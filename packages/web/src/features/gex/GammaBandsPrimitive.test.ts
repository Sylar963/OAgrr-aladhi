import type { SeriesAttachedParameter, Time } from 'lightweight-charts';
import { describe, expect, it, vi } from 'vitest';
import { GammaBandsPrimitive } from './GammaBandsPrimitive';
import type { GammaHeatmap } from './gamma-heatmap';

function renderHeatmap(heatmap: GammaHeatmap) {
  const gradients: Array<{ addColorStop: ReturnType<typeof vi.fn> }> = [];
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => {
      const gradient = { addColorStop: vi.fn() };
      gradients.push(gradient);
      return gradient;
    }),
  };
  const primitive = new GammaBandsPrimitive();
  primitive.attached({
    series: { priceToCoordinate: (price: number) => 120 - price },
    chart: { timeScale: () => ({ timeToCoordinate: () => 100 }) },
    requestUpdate: vi.fn(),
  } as unknown as SeriesAttachedParameter<Time>);
  primitive.update({ callWall: 115, putWall: 85, gammaFlip: 100 }, 123);
  primitive.setHeatmap(heatmap);
  const renderer = primitive.paneViews()[0]!.renderer()!;
  renderer.draw({
    useBitmapCoordinateSpace: (callback) =>
      callback({
        context: context as unknown as CanvasRenderingContext2D,
        bitmapSize: { width: 800, height: 80 },
        horizontalPixelRatio: 2,
        verticalPixelRatio: 2,
      } as Parameters<typeof callback>[0]),
  } as Parameters<typeof renderer.draw>[0]);
  return { context, gradients };
}

describe('GammaBandsPrimitive heatmap', () => {
  it('renders only after the latest candle, at device pixel scale, with a transparent zero crossing', () => {
    const { context, gradients } = renderHeatmap({
      points: [
        { price: 80, gexUsdMillions: -10 },
        { price: 120, gexUsdMillions: 10 },
      ],
      maxMagnitude: 10,
      opacity: 0.6,
    });
    expect(context.rect).toHaveBeenCalledWith(200, 0, 600, 80);
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(200, 0, 600, 80);
    expect(gradients[0]!.addColorStop.mock.calls).toEqual([
      [0, 'rgba(239, 70, 101, 0.6)'],
      [0.5, 'rgba(0, 0, 0, 0)'],
      [1, 'rgba(0, 233, 151, 0.6)'],
    ]);
  });

  it('leaves missing and zero profiles unshaded even when both walls exist', () => {
    for (const points of [
      [],
      [
        { price: 80, gexUsdMillions: 0 },
        { price: 120, gexUsdMillions: 0 },
      ],
    ]) {
      const { context } = renderHeatmap({ points, maxMagnitude: 0, opacity: 0.65 });
      expect(context.fillRect).not.toHaveBeenCalled();
      expect(context.fillText).toHaveBeenCalledTimes(3);
    }
  });

  it('paints a continuous surface across multiple samples without seams between bands', () => {
    const { context, gradients } = renderHeatmap({
      points: [
        { price: 80, gexUsdMillions: -10 },
        { price: 100, gexUsdMillions: 0 },
        { price: 120, gexUsdMillions: 5 },
      ],
      maxMagnitude: 10,
      opacity: 0.6,
    });
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(200, 0, 600, 80);
    expect(gradients[0]!.addColorStop.mock.calls).toEqual([
      [0, 'rgba(239, 70, 101, 0.6)'],
      [0.5, 'rgba(0, 233, 151, 0)'],
      [1, 'rgba(0, 233, 151, 0.3)'],
    ]);
  });

  it('extends the outline left with magnitude and pinches to its baseline at zero', () => {
    const { context } = renderHeatmap({
      points: [
        { price: 80, gexUsdMillions: -10 },
        { price: 100, gexUsdMillions: 0 },
        { price: 120, gexUsdMillions: 5 },
      ],
      maxMagnitude: 10,
      opacity: 0.35,
    });
    expect(context.moveTo).toHaveBeenCalledWith(expect.closeTo(292.16), 80);
    expect(context.lineTo).toHaveBeenCalledWith(776, 40);
    expect(context.lineTo).toHaveBeenCalledWith(expect.closeTo(534.08), 0);
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(200, 0, 600, 80);
  });

  it('can hide the outline while retaining the gradient and gamma levels', () => {
    const { context } = renderHeatmap({
      points: [
        { price: 80, gexUsdMillions: -10 },
        { price: 120, gexUsdMillions: 10 },
      ],
      maxMagnitude: 10,
      opacity: 0.35,
      profileOutline: false,
    });
    expect(context.lineTo).not.toHaveBeenCalledWith(776, expect.any(Number));
    expect(context.fillRect).toHaveBeenCalledOnce();
    expect(context.fillText).toHaveBeenCalledTimes(3);
  });
});
