import { MAX_CUSTOM_TABS } from '@lib/custom-tabs';
import { useLocaleStore } from '@lib/i18n';
import { MAIN_MARKET_ID, useAppStore } from '@stores/app-store';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TemplatePicker from './TemplatePicker';

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    },
  });
});
afterAll(() => {
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    customTabs: [],
    activeMarketId: MAIN_MARKET_ID,
  });
  useLocaleStore.getState().setLocale('en');
});
afterEach(cleanup);

describe('workspace template picker', () => {
  it('previews the included panels and creates the selected named setup', () => {
    const close = vi.fn();
    render(<TemplatePicker onClose={close} />);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByText('Creates a new tab with the current ticker.')).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'Trade planning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(useAppStore.getState().customTabs[0]).toMatchObject({
      name: 'Trade planning',
      templateId: 'planning',
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('can be canceled before any tab or layout is created', () => {
    const close = vi.fn();
    const before = useAppStore.getState().builtinLayouts;
    render(<TemplatePicker onClose={close} />);
    fireEvent.cancel(screen.getByRole('dialog'));
    expect(close).toHaveBeenCalledOnce();
    expect(useAppStore.getState().customTabs).toEqual([]);
    expect(useAppStore.getState().builtinLayouts).toBe(before);
  });

  it('fills an empty target without creating a second tab', () => {
    useAppStore.getState().createCustomTab('My desk');
    const id = useAppStore.getState().activeMarketId;
    render(<TemplatePicker targetTabId={id} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use in this tab' }));
    expect(useAppStore.getState().customTabs).toHaveLength(1);
    expect(useAppStore.getState().customTabs[0]).toMatchObject({
      id,
      name: 'My desk',
      templateId: 'overview',
    });
  });

  it('switches to creating a new tab if the target gains content while the picker is open', () => {
    useAppStore.getState().createCustomTab('My desk');
    const id = useAppStore.getState().activeMarketId;
    render(<TemplatePicker targetTabId={id} onClose={vi.fn()} />);
    act(() => useAppStore.getState().addWidget({ id: 'news', kind: 'news' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(useAppStore.getState().customTabs).toHaveLength(2);
    expect(useAppStore.getState().customTabs[0]?.kinds).toEqual(['news']);
  });

  it('explains the tab limit and disables creating another workspace', () => {
    for (let i = 0; i < MAX_CUSTOM_TABS; i++) useAppStore.getState().createCustomTab(`Desk ${i}`);
    render(<TemplatePicker onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Create workspace' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('status').textContent).toContain('Close one');
  });

  it('provides the complete picker in Spanish', () => {
    useLocaleStore.getState().setLocale('es');
    render(<TemplatePicker onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Vista del mercado' })).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'Espacio en blanco' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear espacio' }));
    expect(useAppStore.getState().customTabs[0]).toMatchObject({
      name: 'Espacio en blanco',
      kinds: [],
    });
  });
});
