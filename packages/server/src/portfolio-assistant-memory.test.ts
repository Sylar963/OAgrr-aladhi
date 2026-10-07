import { describe, expect, it } from 'vitest';

import {
  buildMemoryDistillationRequest,
  type DistilledMemory,
  memoryItemViolation,
  mergeUserMemory,
  parseDistilledMemory,
  parseStoredMemoryItems,
  type StoredMemoryItem,
  toPortfolioAssistantMemory,
  toUserMemoryFacts,
} from './portfolio-assistant-memory.js';

const NOW = new Date('2026-10-07T00:00:00.000Z');
const THREAD = '6f1c1d38-2a4c-4b8e-9b77-0f5d7f0e9a11';

function stored(id: string, text: string, overrides: Partial<StoredMemoryItem> = {}): StoredMemoryItem {
  return {
    id,
    text,
    category: 'preferred_structures',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function distilled(items: DistilledMemory['items'], forget: string[] = []): DistilledMemory {
  return { items, forget };
}

let counter = 0;
const options = {
  now: NOW,
  threadIdsByLabel: new Map([['T1', THREAD]]),
  createId: () => `mem_${(counter += 1).toString(16).padStart(4, '0')}`,
};

describe('memoryItemViolation', () => {
  it.each([
    ['risk_budget', 'Max loss per new trade is $2,000.'],
    ['risk_budget', 'Risks at most 2 contracts per trade.'],
    ['preferred_structures', 'Prefers defined-risk spreads over naked short options.'],
    ['experience_level', 'Has traded options for 3 years.'],
    ['venues', 'Trades on Deribit and Thalex.'],
    ['goals', 'Typical holding period is 30-60 days.'],
    ['explanation_style', 'Wants short answers with a table.'],
    ['explicit_note', 'Asked to always show the worst case first.'],
  ] as const)('accepts durable %s: %s', (category, text) => {
    expect(memoryItemViolation(category, text)).toBeNull();
  });

  it.each([
    ['preferred_structures', 'Is long 2x BTC-27DEC26-70000-C.', 'instrument'],
    ['goals', 'Holds 3 BTC 70000 C calls.', 'instrument'],
    ['explicit_note', 'Unrealized PnL is -$1,200.', 'position'],
    ['explicit_note', 'Account balance is large.', 'position'],
    ['risk_budget', 'BTC spot at $62,000 is the limit.', 'price_or_holding'],
    ['goals', 'Wants BTC above 70000.', 'price'],
    ['explicit_note', 'portfolioRef is pref_QUFBQUFBQUFBQUFBQUFBQQ.', 'reference'],
    ['explicit_note', 'Thread 6f1c1d38-2a4c-4b8e-9b77-0f5d7f0e9a11 matters.', 'identifier'],
    ['venues', 'Deribit account ID 48213.', 'identifier'],
    ['venues', 'Uses wallet 0xabc123def456.', 'identifier'],
    ['goals', 'Wants to hedge today.', 'time_sensitive'],
    ['goals', 'Plans to roll on Oct 9.', 'time_sensitive'],
    ['goals', 'Plans to roll on 2026-10-09.', 'time_sensitive'],
    ['preferred_structures', 'Bought the 25-delta put.', 'position'],
  ] as const)('rejects %s: %s', (category, text, reason) => {
    expect(memoryItemViolation(category, text)).toBe(reason);
  });

  it('rejects sizes outside risk_budget', () => {
    expect(memoryItemViolation('preferred_structures', 'Trades 5 contracts at a time.')).toBe('size');
  });
});

describe('parseDistilledMemory', () => {
  it('accepts a fenced JSON object', () => {
    const result = parseDistilledMemory(
      '```json\n{"items":[{"category":"venues","text":"Trades on Deribit.","source":"T1"}]}\n```',
    );
    expect(result).toEqual({
      ok: true,
      value: { items: [{ category: 'venues', text: 'Trades on Deribit.', source: 'T1' }], forget: [] },
    });
  });

  it('reports prose, malformed JSON and schema mismatches without throwing', () => {
    expect(parseDistilledMemory('Nothing to remember.')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseDistilledMemory('{"items": [}')).toMatchObject({ ok: false, reason: 'invalid_json' });
    expect(
      parseDistilledMemory('{"items":[{"category":"positions","text":"x"}]}'),
    ).toMatchObject({ ok: false, reason: 'schema_mismatch' });
    expect(parseDistilledMemory('{"memory":[]}')).toMatchObject({
      ok: false,
      reason: 'schema_mismatch',
    });
  });
});

describe('mergeUserMemory', () => {
  it('drops filtered items, dedupes and attributes the source thread', () => {
    const result = mergeUserMemory(
      [stored('mem_old', 'Prefers put spreads.')],
      distilled([
        { category: 'preferred_structures', text: 'prefers  put spreads.' },
        { category: 'venues', text: 'Trades on Deribit.', source: 'T1' },
        { category: 'venues', text: 'Trades on Deribit.' },
        { category: 'explicit_note', text: 'Long BTC-27DEC26-70000-C.' },
        { category: 'goals', text: 'Current PnL is $400.' },
      ]),
      options,
    );
    expect(result.items.map((item) => item.text)).toEqual([
      'prefers put spreads.',
      'Trades on Deribit.',
    ]);
    expect(result.items[1]?.sourceThreadId).toBe(THREAD);
    expect(result.rejected).toEqual([
      { category: 'explicit_note', reason: 'instrument' },
      { category: 'goals', reason: 'position' },
    ]);
    expect(result.items.some((item) => item.id === 'mem_old')).toBe(false);
  });

  it('lets the newest statement win through replaces, forget and single-valued categories', () => {
    const result = mergeUserMemory(
      [
        stored('mem_budget', 'Max loss per trade is $1,000.', { category: 'risk_budget' }),
        stored('mem_level', 'New to options.', { category: 'experience_level' }),
        stored('mem_style', 'Wants long explanations.', { category: 'explanation_style' }),
      ],
      distilled(
        [
          { category: 'risk_budget', text: 'Max loss per trade is $2,500.', replaces: 'mem_budget' },
          { category: 'experience_level', text: 'Has traded options for 2 years.' },
        ],
        ['mem_style'],
      ),
      options,
    );
    expect(result.items.map((item) => item.text)).toEqual([
      'Max loss per trade is $2,500.',
      'Has traded options for 2 years.',
    ]);
    expect(result.removed).toBe(3);
    expect(result.items.every((item) => item.updatedAt === NOW.toISOString())).toBe(true);
  });

  it('caps at 12 items and 1,500 rendered characters, keeping the newest', () => {
    const existing = Array.from({ length: 12 }, (_, index) =>
      stored(`mem_e${index}`, `Existing preference number ${index} ${'x'.repeat(100)}`, {
        updatedAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
      }),
    );
    const result = mergeUserMemory(
      existing,
      distilled([{ category: 'venues', text: 'Trades on Thalex.' }]),
      options,
    );
    expect(result.items.length).toBeLessThanOrEqual(12);
    expect(result.items[0]?.text).toBe('Trades on Thalex.');
    expect(result.items[1]?.id).toBe('mem_e11');
    const rendered = result.items.map((item) => `- [${item.category}] ${item.text}`).join('\n');
    expect(rendered.length).toBeLessThanOrEqual(1_500);
    expect(result.items.some((item) => item.id === 'mem_e0')).toBe(false);
  });
});

describe('buildMemoryDistillationRequest', () => {
  it('labels threads, bounds assistant text and lists existing items without sources', () => {
    const request = buildMemoryDistillationRequest(
      [stored('mem_old', 'Prefers put spreads.', { sourceThreadId: THREAD })],
      [
        { threadId: THREAD, role: 'user', content: 'Remember my max loss is $2k', createdAt: NOW },
        { threadId: THREAD, role: 'assistant', content: 'y'.repeat(2_000), createdAt: NOW },
      ],
    );
    expect(request.threadIdsByLabel.get('T1')).toBe(THREAD);
    expect(request.contextMessage).toContain('[T1] user: Remember my max loss is $2k');
    expect(request.contextMessage).toContain('"id":"mem_old"');
    expect(request.contextMessage).not.toContain(THREAD);
    expect(request.contextMessage).not.toContain('y'.repeat(401));
  });
});

describe('stored memory mapping', () => {
  const row = {
    userId: 'user-a',
    content: '',
    items: [
      stored('mem_a', 'Prefers put spreads.', { sourceThreadId: THREAD }),
      { id: 'mem_bad', text: 'x', category: 'positions', updatedAt: 'nope' },
    ],
    lastDistilledAt: NOW,
    updatedAt: NOW,
  };

  it('drops invalid stored items', () => {
    expect(parseStoredMemoryItems(row.items).map((item) => item.id)).toEqual(['mem_a']);
  });

  it('exposes only category and text to the model', () => {
    expect(toUserMemoryFacts(row)).toEqual({
      items: [{ category: 'preferred_structures', text: 'Prefers put spreads.' }],
      updatedAt: NOW.toISOString(),
    });
    expect(toUserMemoryFacts({ ...row, items: [] })).toBeNull();
    expect(toUserMemoryFacts(null)).toBeNull();
  });

  it('maps the API view', () => {
    expect(toPortfolioAssistantMemory(row)).toEqual({
      items: [
        {
          id: 'mem_a',
          text: 'Prefers put spreads.',
          category: 'preferred_structures',
          sourceThreadId: THREAD,
          updatedAt: Date.parse('2026-10-01T00:00:00.000Z'),
        },
      ],
      updatedAt: NOW.getTime(),
      lastDistilledAt: NOW.getTime(),
    });
    expect(toPortfolioAssistantMemory(null)).toEqual({
      items: [],
      updatedAt: null,
      lastDistilledAt: null,
    });
  });
});
