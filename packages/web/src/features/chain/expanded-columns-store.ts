import { z } from 'zod';
import { create } from 'zustand';

export const EXPANDED_COLUMN_IDS = [
  'fimplied',
  'bid',
  'ask',
  'mid',
  'bidIv',
  'markIv',
  'askIv',
  'spread',
  'toll',
  'delta',
  'theta',
  'oi',
  'break',
  'cost',
  'cons',
  'edge',
] as const;

export type ExpandedColumnId = (typeof EXPANDED_COLUMN_IDS)[number];

export const MID_IV_TOLL_COLUMNS: readonly ExpandedColumnId[] = ['mid', 'bidIv', 'markIv', 'toll'];
export const EXPANDED_COLUMNS_STORAGE_KEY = 'ogg.chainExpandedColumns.v1';

const savedColumnsSchema = z.array(z.string());

function readColumns(): ExpandedColumnId[] {
  try {
    const saved = savedColumnsSchema.safeParse(
      JSON.parse(localStorage.getItem(EXPANDED_COLUMNS_STORAGE_KEY) ?? 'null'),
    );
    if (saved.success) return EXPANDED_COLUMN_IDS.filter((id) => saved.data.includes(id));
  } catch {}
  return [...EXPANDED_COLUMN_IDS];
}

interface ExpandedColumnsState {
  columns: ExpandedColumnId[];
  setColumns: (columns: readonly ExpandedColumnId[]) => void;
}

export const useExpandedColumnsStore = create<ExpandedColumnsState>((set) => ({
  columns: readColumns(),
  setColumns: (selected) => {
    const columns = EXPANDED_COLUMN_IDS.filter((id) => selected.includes(id));
    set({ columns });
    try {
      localStorage.setItem(EXPANDED_COLUMNS_STORAGE_KEY, JSON.stringify(columns));
    } catch {}
  },
}));
