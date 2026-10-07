import type {
  AssistantEvalExpect,
  AssistantEvalExpectedNumber,
  AssistantEvalRequiredMention,
} from './assistant-eval-fixture.js';

export type AssistantEvalCheckName =
  | 'numbers'
  | 'required_mentions'
  | 'structure'
  | 'banned_phrases'
  | 'length'
  | 'tools';

export type AssistantEvalCheckStatus = 'pass' | 'fail' | 'not_applicable' | 'unverified';

export interface AssistantEvalCheckResult {
  check: AssistantEvalCheckName;
  status: AssistantEvalCheckStatus;
  detail: string;
}

export interface AssistantEvalNumberResult {
  label: string;
  expected: number;
  tolerance: number;
  matched: number | null;
  pass: boolean;
}

export interface AssistantEvalToolObservation {
  // null when no trustworthy evidence of tool calls exists for this answer.
  observedTools: string[] | null;
  evidence: string;
  // Calls during the request that no run could claim; a missing tool may be among them.
  unattributedCalls?: number;
}

export interface AssistantEvalGrade {
  pass: boolean;
  checks: AssistantEvalCheckResult[];
  numbers: AssistantEvalNumberResult[];
}

// Seam for an optional rubric score. It is reported beside the deterministic
// grade and never gates a fixture.
export interface AssistantEvalJudge {
  readonly name: string;
  score(input: {
    fixtureId: string;
    question: string;
    answer: string;
  }): Promise<{ score: number; rationale: string }>;
}

const NUMBER_PATTERN =
  /(?<![\w.,])([-−–]?)\s?(\$?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?([kKmM](?![A-Za-z]))?/g;

const SUFFIX_MULTIPLIER: Record<string, number> = { k: 1_000, m: 1_000_000 };

export function normalizeAnswerText(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ | /g, ' ');
}

export function parseAnswerNumbers(answer: string): number[] {
  const values: number[] = [];
  for (const match of normalizeAnswerText(answer).matchAll(NUMBER_PATTERN)) {
    const [, sign, , integer, fraction, suffix] = match;
    if (integer == null) continue;
    const base = Number(`${integer.replace(/,/g, '')}${fraction ? `.${fraction}` : ''}`);
    if (!Number.isFinite(base)) continue;
    const multiplier = suffix ? (SUFFIX_MULTIPLIER[suffix.toLowerCase()] ?? 1) : 1;
    values.push((sign ? -1 : 1) * base * multiplier);
  }
  return values;
}

// Answers phrase losses as "-$120" or "a loss of $120", so magnitudes are compared.
export function matchExpectedNumbers(
  answer: string,
  expected: AssistantEvalExpectedNumber[],
): AssistantEvalNumberResult[] {
  const parsed = parseAnswerNumbers(answer);
  return expected.map((item) => {
    const target = Math.abs(item.value);
    let best: number | null = null;
    for (const value of parsed) {
      const distance = Math.abs(Math.abs(value) - target);
      if (distance <= item.tolerance && (best == null || distance < Math.abs(Math.abs(best) - target)))
        best = value;
    }
    return {
      label: item.label,
      expected: item.value,
      tolerance: item.tolerance,
      matched: best,
      pass: best != null,
    };
  });
}

const ACTION_VERBS = String.raw`buy(?:ing|s)?|bought|sell(?:ing|s)?|sold|add(?:ing|s)?|open(?:ing|s)?|purchas(?:e|es|ing)|writ(?:e|es|ing)`;
// "long"/"short" usually describe the held book ("you are short the Oct 30 call", "Long 0.5
// $90,000 call"); only "go/get long" and an imperative "Short the …" opening a clause count.
const POSITION_VERBS = String.raw`(?:go(?:es|ing)?|get(?:s|ting)?)\s+(?:long|short)\b|(?:^|[.!?:;]\s+|[-*•]\s+|\d+\.\s+|\|\s*)(?:long|short)\s+the\b`;
const ACTION_PATTERN = new RegExp(String.raw`\b(?:${ACTION_VERBS})\b|${POSITION_VERBS}`, 'i');
const RIGHT_PATTERN = /\b(calls?|puts?)\b|\d(?:k|,\d{3})?\s?[CP]\b/i;
const STRIKE_PATTERN = /(?<![\w.])\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])\d{2,3}(?:\.\d+)?k\b|(?<![\w.,])\d{4,6}(?![\d-])/i;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

const ACTION_GLOBAL = new RegExp(ACTION_PATTERN.source, 'gi');
const LEG_CLAUSE_CHARS = 90;

// Outside tables the strike and right must follow the verb in the same clause, so
// "add bearish exposure ... your call spread can lose $4,000" is not a proposal.
function isLegLine(line: string): boolean {
  for (const match of line.matchAll(ACTION_GLOBAL)) {
    const window = line.slice(match.index, match.index + LEG_CLAUSE_CHARS);
    const clause = window.split(/[.;:](?:\s|$)|,\s(?:but|while|and)\s/)[0] ?? '';
    if (RIGHT_PATTERN.test(clause) && STRIKE_PATTERN.test(clause)) return true;
  }
  return false;
}

interface MarkdownTable {
  header: string;
  rows: string[];
}

export function extractMarkdownTables(answer: string): MarkdownTable[] {
  const lines = answer.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const separator = lines[index] ?? '';
    const header = lines[index - 1] ?? '';
    if (!TABLE_SEPARATOR.test(separator) || !header.includes('|')) continue;
    const rows: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && (lines[cursor] ?? '').includes('|')) {
      rows.push(lines[cursor] ?? '');
      cursor += 1;
    }
    tables.push({ header, rows });
    index = cursor;
  }
  return tables;
}

export interface HeldLegRef {
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}

export interface ProposedStructureDetection {
  proposed: boolean;
  inTable: boolean;
  evidence: string | null;
  /** A proposal trades at least one leg the book does not already hold. */
  newLeg: boolean;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const ISO_DATE = /\b\d{4}-(\d{2})-(\d{2})\b/g;
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s*(\\d{1,2})\\b`, 'gi');
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})\\s*${MONTH}`, 'gi');
const STRIKE_TOKEN = /(?<![\w.,-])\$?(\d{1,3}(?:,\d{3})+|\d{4,6})(?:\.\d+)?(?!\d|[,-]\d)|(?<![\w.])(\d{2,3}(?:\.\d+)?)k\b/gi;
const CALL_PATTERN = /\bcalls?\b|\d(?:k|,\d{3})?\s?C\b/i;
const PUT_PATTERN = /\bputs?\b|\d(?:k|,\d{3})?\s?P\b/i;

function monthDay(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function rowExpiries(row: string): Set<string> {
  const found = new Set<string>();
  for (const match of row.matchAll(ISO_DATE)) found.add(`${match[1]}-${match[2]}`);
  for (const match of row.matchAll(MONTH_DAY)) {
    found.add(monthDay(MONTHS.indexOf((match[1] ?? '').toLowerCase()) + 1, Number(match[2])));
  }
  for (const match of row.matchAll(DAY_MONTH)) {
    found.add(monthDay(MONTHS.indexOf((match[2] ?? '').toLowerCase()) + 1, Number(match[1])));
  }
  return found;
}

function rowRights(text: string): Set<'call' | 'put'> {
  const rights = new Set<'call' | 'put'>();
  if (CALL_PATTERN.test(text)) rights.add('call');
  if (PUT_PATTERN.test(text)) rights.add('put');
  return rights;
}

// Strike-like numbers outside 0.5×–2× the held strikes are premiums, P&L or sizes. A table
// header ("Oct 30 calls") supplies the right and expiry for rows that do not repeat them.
function tradesNewLeg(row: string, held: HeldLegRef[], header = ''): boolean {
  if (held.length === 0) return true;
  const strikes = held.map((leg) => leg.strike);
  const low = Math.min(...strikes) * 0.5;
  const high = Math.max(...strikes) * 2;
  const ownRights = rowRights(row);
  const rights = ownRights.size > 0 ? ownRights : rowRights(header);
  const ownExpiries = rowExpiries(row);
  const expiries = ownExpiries.size > 0 ? ownExpiries : rowExpiries(header);
  for (const match of row.matchAll(STRIKE_TOKEN)) {
    const value = match[1] != null ? Number(match[1].replace(/,/g, '')) : Number(match[2]) * 1_000;
    if (!(value >= low && value <= high)) continue;
    const isHeld = held.some(
      (leg) =>
        leg.strike === value &&
        (rights.size === 0 || rights.has(leg.optionRight)) &&
        (expiries.size === 0 || expiries.has(leg.expiry.slice(5))),
    );
    if (!isHeld) return true;
  }
  return false;
}

// A proposal needs an action verb (buy/sell/add, "go long", "short the"), an option right and a
// strike. Plain "long"/"short" are excluded because answers use them to describe the held book.
export function detectProposedStructure(
  answer: string,
  held: HeldLegRef[] = [],
): ProposedStructureDetection {
  const text = normalizeAnswerText(answer);
  const proposals: Array<{ row: string; header: string; inTable: boolean }> = [];
  for (const table of extractMarkdownTables(text)) {
    const headerHasAction = /\b(side|action|trade|buy|sell)\b/i.test(table.header);
    const headerHasRight = RIGHT_PATTERN.test(table.header);
    for (const row of table.rows) {
      const actionable = ACTION_PATTERN.test(row) || (headerHasAction && /\b(long|short)\b/i.test(row));
      if (actionable && (RIGHT_PATTERN.test(row) || headerHasRight) && STRIKE_PATTERN.test(row)) {
        proposals.push({ row: row.trim(), header: table.header.trim(), inTable: true });
      }
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (isLegLine(line)) proposals.push({ row: line.trim(), header: '', inTable: false });
  }
  const fresh = proposals.find((proposal) => tradesNewLeg(proposal.row, held, proposal.header));
  const shown = fresh ?? proposals[0];
  return {
    proposed: shown != null,
    inTable: shown?.inTable ?? false,
    evidence: shown == null ? null : shown.inTable && !RIGHT_PATTERN.test(shown.row) ? `${shown.header} → ${shown.row}` : shown.row,
    newLeg: fresh != null,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "…" or "..." inside a banned phrase matches up to 80 characters of anything.
export function bannedPhrasePattern(phrase: string): RegExp {
  const parts = normalizeAnswerText(phrase)
    .split(/\s*(?:…|\.\.\.)\s*/)
    .map((part) => escapeRegExp(part.trim()).replace(/\s+/g, '\\s+'));
  return new RegExp(parts.join('[\\s\\S]{0,80}?'), 'i');
}

export function findBannedPhrases(answer: string, phrases: string[]): string[] {
  const text = normalizeAnswerText(answer);
  return phrases.filter((phrase) => bannedPhrasePattern(phrase).test(text));
}

export function missingMentions(
  answer: string,
  mentions: AssistantEvalRequiredMention[],
): AssistantEvalRequiredMention[] {
  const text = normalizeAnswerText(answer).toLowerCase();
  return mentions.filter(
    (mention) => !mention.anyOf.some((candidate) => text.includes(candidate.toLowerCase())),
  );
}

export function normalizeToolName(name: string): string {
  return name.replace(/^mcp__oggregator__/, '').replace(/^mcp_oggregator_/, '');
}

export function gradeTools(
  requiredTools: string[],
  observation: AssistantEvalToolObservation,
): AssistantEvalCheckResult {
  if (requiredTools.length === 0) {
    return { check: 'tools', status: 'not_applicable', detail: 'No tools required.' };
  }
  if (observation.observedTools == null) {
    return {
      check: 'tools',
      status: 'unverified',
      detail: `Required ${requiredTools.join(', ')}; ${observation.evidence}`,
    };
  }
  const observed = new Set(observation.observedTools.map(normalizeToolName));
  const missing = requiredTools.filter((tool) => !observed.has(normalizeToolName(tool)));
  if (missing.length > 0 && (observation.unattributedCalls ?? 0) > 0) {
    return {
      check: 'tools',
      status: 'unverified',
      detail: `Missing ${missing.join(', ')}, but ${observation.unattributedCalls} call(s) during the request could not be attributed (${observation.evidence}).`,
    };
  }
  return missing.length === 0
    ? { check: 'tools', status: 'pass', detail: `Observed ${[...observed].join(', ')} (${observation.evidence}).` }
    : {
        check: 'tools',
        status: 'fail',
        detail: `Missing ${missing.join(', ')}; observed ${[...observed].join(', ') || 'none'} (${observation.evidence}).`,
      };
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function gradeStructure(
  expect: AssistantEvalExpect,
  answer: string,
  tools: AssistantEvalToolObservation,
  held: HeldLegRef[],
): AssistantEvalCheckResult {
  if (!expect.mustProposeStructure) {
    return { check: 'structure', status: 'not_applicable', detail: 'Structure not required.' };
  }
  const structure = detectProposedStructure(answer, held);
  if (!structure.proposed) {
    return { check: 'structure', status: 'fail', detail: 'No proposed structure (action + strike + call/put) found.' };
  }
  const where = structure.inTable ? 'in table' : 'in text';
  if (!expect.requireNewLeg || structure.newLeg) {
    return { check: 'structure', status: 'pass', detail: `Proposed ${where}: ${structure.evidence}` };
  }
  // A structure_search candidate may legitimately be a buy-back, so it counts without a new leg.
  if ((tools.observedTools ?? []).map(normalizeToolName).includes('oggregator_structure_search')) {
    return {
      check: 'structure',
      status: 'pass',
      detail: `Proposed ${where} after oggregator_structure_search: ${structure.evidence}`,
    };
  }
  return {
    check: 'structure',
    status: 'fail',
    detail: `Only held legs are traded (e.g. closing quotes), but the question asks for a new trade: ${structure.evidence}`,
  };
}

export function gradeAnswer(
  expect: AssistantEvalExpect,
  answer: string,
  tools: AssistantEvalToolObservation,
  held: HeldLegRef[] = [],
): AssistantEvalGrade {
  const numbers = matchExpectedNumbers(answer, expect.numbers);
  const checks: AssistantEvalCheckResult[] = [];

  const missedNumbers = numbers.filter((result) => !result.pass);
  checks.push(
    numbers.length === 0
      ? { check: 'numbers', status: 'not_applicable', detail: 'No required numbers.' }
      : {
          check: 'numbers',
          status: missedNumbers.length === 0 ? 'pass' : 'fail',
          detail:
            missedNumbers.length === 0
              ? `All ${numbers.length} required numbers present.`
              : `Missing ${missedNumbers
                  .map((result) => `${result.label} (${formatNumber(result.expected)} ± ${formatNumber(result.tolerance)})`)
                  .join('; ')}.`,
        },
  );

  const missing = missingMentions(answer, expect.requiredMentions);
  checks.push(
    expect.requiredMentions.length === 0
      ? { check: 'required_mentions', status: 'not_applicable', detail: 'No required mentions.' }
      : {
          check: 'required_mentions',
          status: missing.length === 0 ? 'pass' : 'fail',
          detail:
            missing.length === 0
              ? 'All required mentions present.'
              : `Missing ${missing.map((mention) => mention.label).join('; ')}.`,
        },
  );

  checks.push(gradeStructure(expect, answer, tools, held));

  const banned = findBannedPhrases(answer, expect.bannedPhrases);
  checks.push({
    check: 'banned_phrases',
    status: banned.length === 0 ? 'pass' : 'fail',
    detail: banned.length === 0 ? 'No banned phrases.' : `Found: ${banned.join('; ')}.`,
  });

  checks.push({
    check: 'length',
    status: answer.length <= expect.maxChars ? 'pass' : 'fail',
    detail: `${answer.length} of ${expect.maxChars} characters.`,
  });

  checks.push(gradeTools(expect.requiredTools, tools));

  return {
    pass: answer.trim().length > 0 && checks.every((check) => check.status !== 'fail'),
    checks,
    numbers,
  };
}

export interface AssistantEvalCheckSummary {
  check: AssistantEvalCheckName;
  passed: number;
  failed: number;
  unverified: number;
  notApplicable: number;
  passRate: number | null;
}

export function summarizeChecks(grades: AssistantEvalGrade[]): AssistantEvalCheckSummary[] {
  const names: AssistantEvalCheckName[] = [
    'numbers',
    'required_mentions',
    'structure',
    'banned_phrases',
    'length',
    'tools',
  ];
  return names.map((check) => {
    const results = grades.flatMap((grade) => grade.checks.filter((item) => item.check === check));
    const passed = results.filter((item) => item.status === 'pass').length;
    const failed = results.filter((item) => item.status === 'fail').length;
    return {
      check,
      passed,
      failed,
      unverified: results.filter((item) => item.status === 'unverified').length,
      notApplicable: results.filter((item) => item.status === 'not_applicable').length,
      passRate: passed + failed === 0 ? null : passed / (passed + failed),
    };
  });
}
