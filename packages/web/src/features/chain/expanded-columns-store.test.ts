import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageKey = 'ogg.chainExpandedColumns.v1';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('expanded column preferences', () => {
  it('saves a selection and restores it after the store reloads', async () => {
    const first = await import('./expanded-columns-store');
    first.useExpandedColumnsStore.getState().setColumns(first.MID_IV_TOLL_COLUMNS);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([
      'mid',
      'bidIv',
      'markIv',
      'toll',
    ]);
    vi.resetModules();
    const restored = await import('./expanded-columns-store');
    expect(restored.useExpandedColumnsStore.getState().columns).toEqual(first.MID_IV_TOLL_COLUMNS);
  });

  it.each([
    'not json',
    '{}',
    '["mid", 42]',
    'null',
  ])('falls back to all columns for invalid saved data: %s', async (saved) => {
    localStorage.setItem(storageKey, saved);
    const { useExpandedColumnsStore, EXPANDED_COLUMN_IDS } = await import(
      './expanded-columns-store'
    );
    expect(useExpandedColumnsStore.getState().columns).toEqual(EXPANDED_COLUMN_IDS);
  });

  it('ignores unknown and duplicate saved columns while preserving canonical order', async () => {
    localStorage.setItem(storageKey, JSON.stringify(['toll', 'obsolete', 'mid', 'mid']));
    const { useExpandedColumnsStore } = await import('./expanded-columns-store');
    expect(useExpandedColumnsStore.getState().columns).toEqual(['mid', 'toll']);
  });

  it('preserves an intentional venue-only table after reload', async () => {
    localStorage.setItem(storageKey, '[]');
    const { useExpandedColumnsStore } = await import('./expanded-columns-store');
    expect(useExpandedColumnsStore.getState().columns).toEqual([]);
  });

  it('continues working when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { useExpandedColumnsStore, EXPANDED_COLUMN_IDS, MID_IV_TOLL_COLUMNS } = await import(
      './expanded-columns-store'
    );
    expect(useExpandedColumnsStore.getState().columns).toEqual(EXPANDED_COLUMN_IDS);
    expect(() => useExpandedColumnsStore.getState().setColumns(MID_IV_TOLL_COLUMNS)).not.toThrow();
    expect(useExpandedColumnsStore.getState().columns).toEqual(MID_IV_TOLL_COLUMNS);
  });
});
