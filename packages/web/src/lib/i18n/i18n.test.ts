import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { defineMessages, interpolate, intlLocale, translate, useLocaleStore, useT } from './index';

const bundle = defineMessages(
  { greeting: 'Hello {name}', count: '{n} positions' },
  { greeting: 'Hola {name}', count: '{n} posiciones' },
);

afterEach(() => {
  act(() => useLocaleStore.getState().setLocale('en'));
  localStorage.clear();
});

describe('i18n', () => {
  it('interpolates named variables and leaves unknown placeholders intact', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('translates for the requested locale', () => {
    expect(translate(bundle, 'greeting', { name: 'Ana' }, 'es')).toBe('Hola Ana');
    expect(translate(bundle, 'count', { n: 3 }, 'en')).toBe('3 positions');
  });

  it('re-renders useT consumers and persists when the locale changes', () => {
    const { result } = renderHook(() => useT(bundle));
    expect(result.current('greeting', { name: 'Ana' })).toBe('Hello Ana');

    act(() => useLocaleStore.getState().setLocale('es'));

    expect(result.current('greeting', { name: 'Ana' })).toBe('Hola Ana');
    expect(localStorage.getItem('locale')).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(intlLocale()).toBe('es-419');
  });
});
