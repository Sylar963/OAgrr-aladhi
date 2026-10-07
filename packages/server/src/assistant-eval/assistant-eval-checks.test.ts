import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  bannedPhrasePattern,
  detectProposedStructure,
  findBannedPhrases,
  gradeAnswer,
  gradeTools,
  matchExpectedNumbers,
  missingMentions,
  parseAnswerNumbers,
  summarizeChecks,
} from './assistant-eval-checks.js';
import { type AssistantEvalExpect, AssistantEvalFixtureSchema } from './assistant-eval-fixture.js';

const NO_TOOLS = { observedTools: null, evidence: 'no tool log evidence' };

function expectation(overrides: Partial<AssistantEvalExpect> = {}): AssistantEvalExpect {
  return {
    numbers: [],
    requiredMentions: [],
    requiredTools: [],
    mustProposeStructure: false,
    requireNewLeg: false,
    bannedPhrases: ['I cannot identify', 'my earlier … were wrong'],
    maxChars: 2_000,
    ...overrides,
  };
}

describe('parseAnswerNumbers', () => {
  it('parses dollar, comma, decimal, negative and k-suffixed values', () => {
    expect(
      parseAnswerNumbers('Spot **$83,886.66**, loss -$1,234.5, strike 85k, IV 45.2%, cost $1.2M'),
    ).toEqual([83_886.66, -1_234.5, 85_000, 45.2, 1_200_000]);
  });

  it('reads unicode minus signs and ignores hyphens inside dates', () => {
    expect(parseAnswerNumbers('PnL −$18.05 on 2026-10-30')).toEqual([-18.05, 2026, 10, 30]);
  });

  it('does not treat words starting with m or k as suffixes', () => {
    expect(parseAnswerNumbers('5 min and 3 kittens')).toEqual([5, 3]);
  });
});

describe('matchExpectedNumbers', () => {
  const expected = [
    { label: 'spot', value: 83_886.66, tolerance: 1, source: 'headline.spotUsd' },
    { label: 'pnl', value: -412.37, tolerance: 0.5, source: 'horizonScenarios' },
  ];

  it('matches magnitudes within tolerance', () => {
    const results = matchExpectedNumbers('Spot $83,887 and a loss of $412.10', expected);
    expect(results.map((result) => result.pass)).toEqual([true, true]);
    expect(results[0]?.matched).toBe(83_887);
  });

  it('fails numbers outside tolerance', () => {
    const results = matchExpectedNumbers('Spot $83.9k, loss $410', expected);
    expect(results.map((result) => result.pass)).toEqual([false, false]);
  });
});

describe('detectProposedStructure', () => {
  it('finds a leg row in a markdown table', () => {
    const answer = [
      '| Leg | Side | Strike |',
      '| --- | --- | --- |',
      '| Oct 30 put | Buy | 80,000 |',
    ].join('\n');
    expect(detectProposedStructure(answer)).toMatchObject({ proposed: true, inTable: true });
  });

  it('finds a leg in a bullet', () => {
    expect(detectProposedStructure('- **Buy** 1x Oct 30 80k put for $910').proposed).toBe(true);
  });

  it('requires the strike and right in the same clause as the action verb', () => {
    const answer =
      'You can add bearish exposure, but not as a standalone trade while keeping loss within $1,300. Your Oct 30 $84,000/$90,000 short call spread alone can lose $4,000.';
    expect(detectProposedStructure(answer).proposed).toBe(false);
    expect(detectProposedStructure('Sell 1 Oct 30 $90,000 call; it caps nothing.').proposed).toBe(true);
  });

  it('does not treat a description of held legs as a proposal', () => {
    const answer = [
      'You are short the Oct 30 85,000 call and long the Oct 16 87,000 call.',
      'I cannot identify a structure that fits.',
      '| Leg | Strike |',
      '| --- | --- |',
      '| Short Oct 30 call | 85,000 |',
    ].join('\n');
    expect(detectProposedStructure(answer).proposed).toBe(false);
  });
});

const REFERENCE_HELD = [
  { expiry: '2026-10-16', strike: 87_000, optionRight: 'call' as const },
  { expiry: '2026-10-30', strike: 85_000, optionRight: 'call' as const },
];

const CLOSING_TABLE = [
  '### What closing it would cost',
  '| Leg | Closing quote | Action |',
  '|---|---:|---|',
  '| Oct 16 $87,000 call | **$1,089.27** bid | Sell |',
  '| Oct 30 $85,000 call | **$3,093.90** ask | Buy back |',
].join('\n');

describe('new-leg detection', () => {
  it('treats a table that only prices closing held legs as no new leg', () => {
    expect(detectProposedStructure(CLOSING_TABLE, REFERENCE_HELD)).toMatchObject({
      proposed: true,
      inTable: true,
      newLeg: false,
    });
  });

  it('finds a new strike, right or expiry next to closing legs', () => {
    const twoPart = 'Buy back the Oct 30 85k call and buy 0.1x Oct 23 80k put for $412.';
    expect(detectProposedStructure(twoPart, REFERENCE_HELD)).toMatchObject({ newLeg: true, evidence: twoPart });
    expect(detectProposedStructure('- Buy 1x Nov 27 85,000 call', REFERENCE_HELD).newLeg).toBe(true);
    expect(detectProposedStructure('- Buy 1x 2026-10-30 85,000 put', REFERENCE_HELD).newLeg).toBe(true);
    expect(detectProposedStructure('- Sell 1x 2026-10-16 87,000 call at $1,089', REFERENCE_HELD).newLeg).toBe(false);
    const table = [CLOSING_TABLE, '', '| Trade | Leg |', '|---|---|', '| Buy | Oct 30 90,000 call |'].join('\n');
    expect(detectProposedStructure(table, REFERENCE_HELD)).toMatchObject({
      newLeg: true,
      evidence: '| Buy | Oct 30 90,000 call |',
    });
  });

  it('counts any proposal as new without a held book', () => {
    expect(detectProposedStructure(CLOSING_TABLE).newLeg).toBe(true);
  });
});

// Answer snippets below are verbatim from packages/server/.eval-out runs unless marked constructed.
const CONDOR_HELD = [
  { expiry: '2026-10-30', strike: 74_000, optionRight: 'put' as const },
  { expiry: '2026-10-30', strike: 78_000, optionRight: 'put' as const },
  { expiry: '2026-10-30', strike: 90_000, optionRight: 'call' as const },
  { expiry: '2026-10-30', strike: 94_000, optionRight: 'call' as const },
];
const BEAR_PUT_HELD = [
  { expiry: '2026-10-30', strike: 82_000, optionRight: 'put' as const },
  { expiry: '2026-10-30', strike: 76_000, optionRight: 'put' as const },
];

describe('action verb forms', () => {
  it('reads "buying" as a proposal (Run A reference-cap-upside, Run B budget-long-vol-condor)', () => {
    const capUpside =
      'Buying one Oct 30 $90,000 call against your short Oct 30 $85,000 call is the tightest cover shown under your **$1,500** extra-cost limit.';
    expect(detectProposedStructure(capUpside, REFERENCE_HELD)).toMatchObject({ proposed: true, newLeg: true });
    const condor =
      'Consider buying 0.1 BTC each of the Oct 30 $84,000 call and put. The indicative asks are $3,576.12 and $3,531.15 per BTC, respectively.';
    expect(detectProposedStructure(condor, CONDOR_HELD)).toMatchObject({ proposed: true, newLeg: true });
  });

  it('reads "go long" and "short the" as verbs (constructed: no saved answer uses them)', () => {
    expect(detectProposedStructure('Go long the Oct 30 $90,000 call for $1,361.61.', REFERENCE_HELD)).toMatchObject({
      proposed: true,
      newLeg: true,
    });
    expect(detectProposedStructure('- Short the Nov 27 $78,000 put against it.', BEAR_PUT_HELD).newLeg).toBe(true);
  });

  it('does not read a held-book "Long 0.5 … call" row as a proposal (Run 02-58 horizon-minus10-7d)', () => {
    const heldTable = [
      '| Expiry | Position | Projected P&L |',
      '|---|---|---:|',
      '| Oct 30 | Long $80,000 put | **+$4,111.19** |',
      '| Nov 27 | Short $95,000 call | **+$1,389.02** |',
      '| Dec 25 | Long 0.5 $90,000 call | **−$1,465.01** |',
    ].join('\n');
    expect(detectProposedStructure(heldTable).proposed).toBe(false);
  });
});

describe('table header option right', () => {
  // Run 2026-10-07T05-04-30-279Z budget-bullish-bear-put-spread: the right is only in the header.
  const headerRightTable = [
    '### Candidates to check',
    '',
    '| Oct 30 calls | Indicative buy ask | Indicative sell bid |',
    '|---|---:|---:|',
    '| Buy $90,000 / sell $94,000 | $1,361.61 | $610.51 |',
    '| Buy $92,000 / sell $96,000 | $940.02 | $405.20 |',
  ].join('\n');

  it('applies a "calls" header to rows that only carry strikes', () => {
    expect(detectProposedStructure(headerRightTable, BEAR_PUT_HELD)).toMatchObject({
      proposed: true,
      inTable: true,
      newLeg: true,
      evidence: '| Oct 30 calls | Indicative buy ask | Indicative sell bid | → | Buy $90,000 / sell $94,000 | $1,361.61 | $610.51 |',
    });
    const grade = gradeAnswer(
      expectation({ mustProposeStructure: true, requireNewLeg: true }),
      headerRightTable,
      NO_TOOLS,
      BEAR_PUT_HELD,
    );
    expect(grade.checks.find((check) => check.check === 'structure')?.status).toBe('pass');
  });

  it('keeps requireNewLeg: a header right plus held strikes and expiry is still only held legs', () => {
    const closing = ['| Oct 30 calls | Action |', '|---|---|', '| $85,000 | Buy back |'].join('\n');
    expect(detectProposedStructure(closing, REFERENCE_HELD)).toMatchObject({ proposed: true, newLeg: false });
    const grade = gradeAnswer(
      expectation({ mustProposeStructure: true, requireNewLeg: true }),
      closing,
      NO_TOOLS,
      REFERENCE_HELD,
    );
    expect(grade.checks.find((check) => check.check === 'structure')?.status).toBe('fail');
  });
});

describe('banned phrases', () => {
  it('matches ellipsis wildcards and curly quotes', () => {
    expect(bannedPhrasePattern('my earlier … were wrong').test('My earlier spot and PnL figures were wrong')).toBe(true);
    expect(bannedPhrasePattern('my previous … were wrong').test('My previous **+$232.38** and **$82,950** figures were wrong')).toBe(true);
    expect(findBannedPhrases('I can’t identify one; I cannot identify any', ['I cannot identify', "I can't identify"])).toEqual([
      'I cannot identify',
      "I can't identify",
    ]);
  });

  it('does not match across long spans', () => {
    const answer = `My earlier ${'x'.repeat(200)} were wrong`;
    expect(findBannedPhrases(answer, ['my earlier … were wrong'])).toEqual([]);
  });
});

describe('missingMentions', () => {
  it('accepts any of the alternatives case-insensitively', () => {
    const mentions = [{ label: 'unbounded', anyOf: ['unbounded', 'uncovered'] }];
    expect(missingMentions('The short call is UNCOVERED after Oct 16', mentions)).toEqual([]);
    expect(missingMentions('Max loss is $18', mentions)).toEqual(mentions);
  });
});

describe('gradeTools', () => {
  it('reports unverified without evidence instead of passing', () => {
    expect(gradeTools(['oggregator_feed_health'], NO_TOOLS).status).toBe('unverified');
  });

  it('normalizes Hermes MCP prefixes', () => {
    const result = gradeTools(['oggregator_feed_health'], {
      observedTools: ['mcp__oggregator__oggregator_feed_health'],
      evidence: 'backend log window',
    });
    expect(result.status).toBe('pass');
  });

  it('fails when a required tool was not observed', () => {
    const result = gradeTools(['oggregator_trade_flow'], { observedTools: [], evidence: 'log' });
    expect(result.status).toBe('fail');
  });
});

describe('gradeAnswer', () => {
  it('fails the reference refusal for the expected reasons', () => {
    const answer =
      'My earlier spot and PnL figures were wrong. I cannot identify an $18-total-risk structure.';
    const grade = gradeAnswer(
      expectation({ mustProposeStructure: true, maxChars: 4_000 }),
      answer,
      NO_TOOLS,
    );
    expect(grade.pass).toBe(false);
    const failed = grade.checks.filter((check) => check.status === 'fail').map((check) => check.check);
    expect(failed).toEqual(['structure', 'banned_phrases']);
  });

  it('passes a direct answer and does not gate on unverified tools', () => {
    const grade = gradeAnswer(
      expectation({
        numbers: [{ label: 'pnl', value: -412.37, tolerance: 0.5, source: 'cell' }],
        requiredTools: ['oggregator_option_chain'],
        mustProposeStructure: true,
      }),
      'Your book loses **$412.37**.\n- **Buy** 1x Oct 30 87,000 call to cap the upside.',
      NO_TOOLS,
    );
    expect(grade.pass).toBe(true);
    expect(grade.checks.find((check) => check.check === 'tools')?.status).toBe('unverified');
  });

  it('requires a new leg when the fixture asks for a new trade, unless structure_search was used', () => {
    const newTrade = expectation({ mustProposeStructure: true, requireNewLeg: true });
    const closing = gradeAnswer(newTrade, CLOSING_TABLE, NO_TOOLS, REFERENCE_HELD);
    expect(closing.pass).toBe(false);
    expect(closing.checks.find((check) => check.check === 'structure')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('Only held legs are traded'),
    });

    const lenient = gradeAnswer(expectation({ mustProposeStructure: true }), CLOSING_TABLE, NO_TOOLS, REFERENCE_HELD);
    expect(lenient.pass).toBe(true);

    const searched = gradeAnswer(
      newTrade,
      CLOSING_TABLE,
      { observedTools: ['mcp__oggregator__oggregator_structure_search'], evidence: 'journal' },
      REFERENCE_HELD,
    );
    expect(searched.checks.find((check) => check.check === 'structure')).toMatchObject({
      status: 'pass',
      detail: expect.stringContaining('after oggregator_structure_search'),
    });

    const fresh = gradeAnswer(newTrade, '- **Buy** 1x Oct 30 90k call for $1,000', NO_TOOLS, REFERENCE_HELD);
    expect(fresh.pass).toBe(true);
  });

  it('fails empty and over-long answers', () => {
    expect(gradeAnswer(expectation(), '', NO_TOOLS).pass).toBe(false);
    expect(gradeAnswer(expectation({ maxChars: 5 }), 'too long answer', NO_TOOLS).pass).toBe(false);
  });

  it('summarizes pass rates excluding unverified and not-applicable checks', () => {
    const grades = [
      gradeAnswer(expectation({ requiredTools: ['x'] }), 'ok', NO_TOOLS),
      gradeAnswer(expectation(), 'I cannot identify one', NO_TOOLS),
    ];
    const summary = summarizeChecks(grades);
    expect(summary.find((row) => row.check === 'banned_phrases')?.passRate).toBe(0.5);
    expect(summary.find((row) => row.check === 'tools')).toMatchObject({
      unverified: 1,
      notApplicable: 1,
      passRate: null,
    });
  });
});

describe('committed fixtures', () => {
  const directory = new URL('./fixtures/', import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith('.json'));

  it('has 12 to 15 fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(files.length).toBeLessThanOrEqual(15);
  });

  it.each(files)('%s validates and matches its file name', (file) => {
    const fixture = AssistantEvalFixtureSchema.parse(
      JSON.parse(readFileSync(new URL(file, directory), 'utf8')),
    );
    expect(`${fixture.id}.json`).toBe(file);
  });
});
