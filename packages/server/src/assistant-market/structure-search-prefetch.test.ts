import { describe, expect, it } from 'vitest';

import {
  planStructureSearchPrefetch,
  type StructureSearchPrefetchContext,
} from './structure-search-prefetch.js';

function context(overrides: Partial<StructureSearchPrefetchContext> = {}): StructureSearchPrefetchContext {
  return {
    underlying: 'BTC',
    portfolioRef: 'pref_test',
    positions: [
      {
        legId: 'l1',
        underlying: 'BTC',
        expiry: '2026-10-30',
        strike: 85_000,
        optionRight: 'call',
        size: -0.5,
        entryPriceUsd: 1_000,
        entryIv: 0.5,
        currentMarkUsd: 900,
        currentIv: 0.5,
        currentIvIsModel: false,
      },
    ],
    riskBudgetFacts: {
      riskWindows: [],
      worstLossUsd: null,
      unboundedAfter: '2026-10-16',
      uncoveredShorts: [],
      note: '',
    },
    ...overrides,
  };
}

describe('planStructureSearchPrefetch', () => {
  it.each([
    ["I'm turning bearish into November. Find me a bearish trade so my total portfolio max loss stays within $2,200.", 'bearish', 2_200],
    ['I want a bullish trade, but my total portfolio max loss must stay within $2,600.', 'bullish', 2_600],
    ['Add a long-vol trade so my total max loss stays within $4,000.', 'long_vol', 4_000],
    ["I'm bearish from here. Propose a trade that keeps my TOTAL portfolio max loss within $18.", 'bearish', 18],
    ['Bullish idea please, max risk 1.5k usd', 'bullish', 1_500],
    ['Bearish trade with a $3k max loss', 'bearish', 3_000],
  ])('reads %s', (question, view, budget) => {
    const plan = planStructureSearchPrefetch(question, [], context());
    expect(plan?.request).toMatchObject({ view, maxTotalRiskUsd: budget, viewFrom: 'question', budgetFrom: 'question' });
    expect(plan?.underlying).toBe('BTC');
  });

  it('leaves questions without a view and a loss budget to the model', () => {
    expect(planStructureSearchPrefetch('What is the most I can lose on this book?', [], context())).toBeNull();
    expect(
      planStructureSearchPrefetch(
        'How do I cap the upside risk on my short Oct 30 85k call? Keep the extra cost under $1,500.',
        [],
        context(),
      ),
    ).toBeNull();
    expect(planStructureSearchPrefetch('Bearish or bullish here? Max loss $2,000.', [], context())).toBeNull();
  });

  it('takes the missing view or budget from an earlier user message', () => {
    const budgetOnly = planStructureSearchPrefetch('What about a $3,000 max loss instead?', ['Find me a bearish trade, max loss $2,000'], context());
    expect(budgetOnly?.request).toMatchObject({ view: 'bearish', viewFrom: 'earlier_message', maxTotalRiskUsd: 3_000, budgetFrom: 'question' });
    const viewOnly = planStructureSearchPrefetch('Same budget, but bullish.', ['Find me a bearish trade, max loss $2,000'], context());
    expect(viewOnly?.request).toMatchObject({ view: 'bullish', viewFrom: 'question', maxTotalRiskUsd: 2_000, budgetFrom: 'earlier_message' });
  });

  it('hedges held shorts only when the book has uncovered shorts', () => {
    const question = 'Hedge my short call, total max loss within $5,000.';
    expect(planStructureSearchPrefetch(question, [], context())).toBeNull();
    const withShorts = context({
      riskBudgetFacts: { ...context().riskBudgetFacts, uncoveredShorts: [{ legId: 'l1', expiry: '2026-10-30', strike: 85_000, right: 'call', size: 0.5 }] },
    });
    expect(planStructureSearchPrefetch(question, [], withShorts)?.request.view).toBe('hedge_held_shorts');
  });

  it('ranks at a move the question names in the direction of the view', () => {
    expect(planStructureSearchPrefetch('Bearish trade for a drop of 8%? If BTC drops 8% I want to profit, max loss $2,000.', [], context())?.request.targetMovePct).toBe(-8);
    expect(planStructureSearchPrefetch('Bullish trade, max loss $2,000, BTC drops 8% first', [], context())?.request.targetMovePct).toBeNull();
  });

  it('sizes new legs like the smallest held leg and needs a single underlying', () => {
    expect(planStructureSearchPrefetch('Bearish trade, max loss $2,000', [], context())?.request.size).toBe(0.5);
    expect(planStructureSearchPrefetch('Bearish trade, max loss $2,000', [], context({ positions: [] }))?.request.size).toBe(1);
    const mixed = context({
      underlying: null,
      positions: [
        ...context().positions,
        { ...context().positions[0]!, legId: 'l2', underlying: 'ETH' },
      ],
    });
    expect(planStructureSearchPrefetch('Bearish trade, max loss $2,000', [], mixed)).toBeNull();
  });
});
