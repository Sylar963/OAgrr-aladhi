import { describe, it, expect, beforeEach } from 'vitest';
import { useChartPanelsStore } from './chart-panels-store.js';

const samplePanel = {
  venue: 'deribit' as const,
  symbol: 'BTC-27JUN26-70000-C',
  underlying: 'BTC',
  expiry: '2026-06-27',
  strike: 70000,
  type: 'call' as const,
};

beforeEach(() => {
  useChartPanelsStore.setState({ panels: [] });
});

describe('chart-panels-store', () => {
  it('openPanel adds a new panel', () => {
    useChartPanelsStore.getState().openPanel(samplePanel);
    expect(useChartPanelsStore.getState().panels).toHaveLength(1);
  });

  it('openPanel is id-deduped — same venue+symbol does not duplicate', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    s.openPanel(samplePanel);
    expect(useChartPanelsStore.getState().panels).toHaveLength(1);
  });

  it('closePanel removes by id', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = useChartPanelsStore.getState().panels[0]!.id;
    s.closePanel(id);
    expect(useChartPanelsStore.getState().panels).toHaveLength(0);
  });

  it('updatePanel merges patch by id', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = useChartPanelsStore.getState().panels[0]!.id;
    s.updatePanel(id, { range: '30d', interval: '5m' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = useChartPanelsStore.getState().panels[0]!;
    expect(p.range).toBe('30d');
    expect(p.interval).toBe('5m');
  });

  it('openPanel defaults chartMode to "price"', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = useChartPanelsStore.getState().panels[0]!;
    expect(p.chartMode).toBe('price');
  });

  it('updatePanel can switch chartMode to attribution', () => {
    const s = useChartPanelsStore.getState();
    s.openPanel(samplePanel);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const id = useChartPanelsStore.getState().panels[0]!.id;
    s.updatePanel(id, { chartMode: 'attribution' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const p = useChartPanelsStore.getState().panels[0]!;
    expect(p.chartMode).toBe('attribution');
  });
});
