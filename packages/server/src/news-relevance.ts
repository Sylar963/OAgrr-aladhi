import type { NewsPin, NewsRelevance, NewsRelevanceTier } from '@oggregator/protocol';

export interface ScorableHeadline {
  id: string;
  text: string;
  handle: string | null;
  timestamp: number;
}

interface RelevanceRule {
  tag: string;
  weight: number;
  match: RegExp;
  requires?: RegExp;
}

// Weights are the score a headline gets from its strongest category alone; extra categories add a
// quarter of their weight. Tune these here, the scorer has no other knobs per topic.
export const RELEVANCE_RULES: readonly RelevanceRule[] = [
  {
    tag: 'crypto-incident',
    weight: 65,
    match:
      /\b(hack(?:ed)?|exploit(?:ed)?|drained|stolen funds|depeg(?:ged)?|(?:halts?|halted|suspends?|suspended|pauses?|paused|freezes?|froze) withdrawals|rug ?pull)\b/i,
  },
  {
    tag: 'war',
    weight: 60,
    match:
      /\b(declares? war|war (?:breaks out|erupts)|declaration of war|missiles?|ballistic|drone (?:attacks?|strikes?)|air ?strikes?|invasion|invade[sd]?|shelling|bombing|bombed|explosions?|nuclear|warheads?|martial law|coup|mobili[sz]ation)\b/i,
  },
  {
    tag: 'macro-data',
    weight: 60,
    match:
      /\b(cpi|ppi|pce|nfp|non-?farm|payrolls|jobless claims|unemployment rate|gdp|retail sales|pmi|jolts)\b/i,
    // A print carries a figure; "could boost GDP" is commentary and falls to central-bank or nothing.
    requires: /\d/,
  },
  {
    tag: 'rates',
    weight: 55,
    match:
      /\b(fomc|rate (?:cut|hike|decision)s?|(?:cuts?|hikes?|raises?|lowers?|holds?) (?:interest )?rates?|basis points?|\d+ ?bps|fed funds)\b/i,
  },
  {
    tag: 'corporate',
    weight: 55,
    match:
      /\b(anthropic|openai|spacex|xai|nvidia|apple|microsoft|tesla|alphabet|google|amazon|meta|microstrategy|saylor|coinbase|binance|tether|circle|blackrock|kraken|robinhood|grayscale|deribit|bybit|okx)\b/i,
    requires:
      /\b(ipo|delay(?:s|ed)?|postpone[sd]?|files?|filed|filing|halts?|halted|probe|investigat\w*|lawsuit|sued|acquires?|acquisition|merger|layoffs?|resigns?|ousted|bankrupt\w*|earnings|guidance|valuation)\b/i,
  },
  {
    tag: 'market-stress',
    weight: 50,
    match:
      /\b(circuit breakers?|trading (?:halt|halted|suspended)|flash crash|(?:market|stocks?|crypto|bitcoin) crash(?:es|ed)?|liquidations?|margin calls?|(?:debt|sovereign|bond) default|default(?:s|ed)? on|insolven(?:t|cy)|files? for bankruptcy|chapter 11|bank run|bailout|contagion|sell-?off|plunges?)\b/i,
  },
  {
    tag: 'central-bank',
    weight: 40,
    match:
      /\b(fed|federal reserve|powell|ecb|lagarde|boj|ueda|boe|bank of (?:canada|england|japan)|pboc|snb|rba|central bank|inflation|treasury yields?|quantitative (?:easing|tightening))\b/i,
  },
  {
    tag: 'regulation',
    weight: 40,
    match:
      /\b(sec|cftc|etfs? (?:approv\w*|deni\w*|reject\w*|decision|filing)|stablecoin (?:bill|law|act)|genius act|clarity act|strategic (?:bitcoin )?reserve|crypto (?:bill|ban|regulation)|executive order|indicted|indictment)\b/i,
  },
  {
    tag: 'trade',
    weight: 40,
    match: /\b(tariffs?|sanctions?|export controls?|embargo|trade (?:war|deal|talks))\b/i,
  },
  {
    tag: 'conflict',
    weight: 35,
    match:
      /\b(wars?|military|troops|attacks?|ceasefire|hostages?|retaliat\w*|clashes|armed forces|idf|hezbollah|hamas|houthis?|pentagon|nato)\b/i,
  },
  {
    tag: 'energy',
    weight: 35,
    match:
      /\b(opec\+?|crude|oil prices?|brent|wti|natural gas|energy (?:costs|prices|crisis)|strait of hormuz|refiner(?:y|ies))\b/i,
  },
  {
    tag: 'ipo',
    weight: 30,
    match: /\b(ipos?|go(?:es|ing)? public|direct listing|spac)\b/i,
  },
  {
    tag: 'breaking',
    weight: 15,
    match: /(\bbreaking\b|\bjust in\b|\burgent\b|🚨)/i,
  },
];

const RULE_WEIGHT = new Map(RELEVANCE_RULES.map((rule) => [rule.tag, rule.weight]));

const SOURCE_WEIGHT: Record<string, number> = {
  firstsquawk: 1.15,
  deitaone: 1.15,
  walterbloomberg: 1.15,
  reuters: 1.1,
  business: 1.0,
  zerohedge: 0.95,
  unusual_whales: 0.9,
  techcrunch: 0.85,
  seekingalpha: 0.8,
  elonmusk: 0.7,
  ylecun: 0.7,
};

const CRITICAL_SCORE = 65;
const WATCH_SCORE = 40;
const SECONDARY_TAG_FACTOR = 0.25;
const CAPS_BOOST = 1.1;
const PIN_MATCH = 0.3;
const REPEAT_MATCH = 0.45;
const PIN_SIMILARITY_FULL = 0.6;
const PIN_BOOST = 40;
const PIN_FLOOR = 30;
const PINNED_SCORE = 80;
const PIN_HALF_LIFE_MS = 6 * 60 * 60 * 1000;
const MIN_TIME_DECAY = 0.2;
const DEVELOPMENT_FLOOR = 0.8;
// A new tag only counts as fresh information when it is a real market category, not "breaking".
const DEVELOPMENT_TAG_WEIGHT = 35;
export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

const URL_RE = /https?:\/\/\S+/gi;
const ESCALATION_RE =
  /^(escalat\w*|expand\w*|second|another|confirm\w*|death|dead|killed|casualt\w*|retaliat\w*|widen\w*|imminent)$/;
const STOPWORDS = new Set(
  (
    'the a an and or but of to in on at for with from by as is are was were be been being it its ' +
    'this that these those into over after before about than then said says say will would could ' +
    'should may might has have had not no per via amid against new more most also just read who ' +
    'what when where which while today report reports reported according sources source'
  ).split(' '),
);

interface HeadlineFeatures {
  terms: Set<string>;
  tags: string[];
  base: number;
}

function normalizeTerm(raw: string): string {
  const term = raw.replace(/^[.$%]+|[.]+$/g, '');
  return term.length > 4 && term.endsWith('s') && !term.endsWith('ss') ? term.slice(0, -1) : term;
}

export function keyTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(URL_RE, ' ').split(/[^a-z0-9$%.]+/)) {
    const term = normalizeTerm(raw);
    if (term.length === 0 || STOPWORDS.has(term)) continue;
    if (term.length < 3 && !/\d/.test(term)) continue;
    out.add(term);
  }
  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared++;
  return shared < 2 ? 0 : shared / Math.sqrt(a.size * b.size);
}

function isShouting(text: string): boolean {
  const letters = text.replace(URL_RE, '').replace(/[^A-Za-z]/g, '');
  if (letters.length < 25) return false;
  return letters.replace(/[^A-Z]/g, '').length / letters.length >= 0.8;
}

export function headlineFeatures(item: Pick<ScorableHeadline, 'text' | 'handle'>): HeadlineFeatures {
  const text = item.text.replace(URL_RE, ' ');
  const weights: number[] = [];
  const tags: string[] = [];
  for (const rule of RELEVANCE_RULES) {
    if (!rule.match.test(text)) continue;
    if (rule.requires && !rule.requires.test(text)) continue;
    tags.push(rule.tag);
    weights.push(rule.weight);
  }
  const [top = 0, ...rest] = weights;
  const tagged = top + SECONDARY_TAG_FACTOR * rest.reduce((sum, w) => sum + w, 0);
  const source = SOURCE_WEIGHT[item.handle?.toLowerCase() ?? ''] ?? 1;
  const base = tagged * source * (isShouting(item.text) ? CAPS_BOOST : 1);
  return { terms: keyTerms(item.text), tags, base };
}

function tierFor(score: number): NewsRelevanceTier {
  if (score >= CRITICAL_SCORE) return 'critical';
  if (score >= WATCH_SCORE) return 'watch';
  return 'normal';
}

function result(
  score: number,
  tags: string[],
  pinId: string | null,
  repeat: boolean,
): NewsRelevance {
  const clamped = Math.round(Math.min(100, Math.max(0, score)));
  return { score: clamped, tier: tierFor(clamped), tags, pinId, repeat };
}

// New facts break through the decay: a figure, an escalation word, or a market category the story
// has not touched yet. Rewording what is already known does not.
function isDevelopment(
  features: HeadlineFeatures,
  knownTerms: Set<string>,
  knownTags: Set<string>,
): boolean {
  for (const term of features.terms) {
    if (knownTerms.has(term)) continue;
    if (/\d/.test(term) || ESCALATION_RE.test(term)) return true;
  }
  return features.tags.some(
    (tag) => !knownTags.has(tag) && (RULE_WEIGHT.get(tag) ?? 0) >= DEVELOPMENT_TAG_WEIGHT,
  );
}

export interface RelevanceContextEntry {
  item: ScorableHeadline;
  features: HeadlineFeatures;
}

export interface PinContext {
  pin: NewsPin;
  features: HeadlineFeatures;
}

/**
 * `earlier` holds headlines published before `item` inside REPEAT_WINDOW_MS, oldest first. Pins
 * are the human-chosen stories of the moment: headlines about them are lifted, then decay with the
 * time since the pin and with each retelling that adds nothing new.
 */
export function scoreHeadline(
  entry: RelevanceContextEntry,
  earlier: readonly RelevanceContextEntry[],
  pins: readonly PinContext[],
): NewsRelevance {
  const { item, features } = entry;

  const own = pins.find((p) => p.pin.id === item.id);
  if (own) return result(Math.max(features.base, PINNED_SCORE), features.tags, own.pin.id, false);

  let pin: PinContext | null = null;
  let pinSimilarity = 0;
  for (const candidate of pins) {
    if (candidate.pin.timestamp > item.timestamp) continue;
    const sim = similarity(features.terms, candidate.features.terms);
    if (sim >= PIN_MATCH && sim > pinSimilarity) {
      pin = candidate;
      pinSimilarity = sim;
    }
  }

  const related = earlier.filter((e) =>
    pin
      ? e.item.timestamp >= pin.pin.timestamp &&
        e.item.id !== pin.pin.id &&
        similarity(e.features.terms, pin.features.terms) >= PIN_MATCH
      : similarity(features.terms, e.features.terms) >= REPEAT_MATCH,
  );

  const knownTerms = new Set<string>(pin ? pin.features.terms : []);
  const knownTags = new Set<string>(pin ? pin.features.tags : []);
  for (const e of related) {
    for (const term of e.features.terms) knownTerms.add(term);
    for (const tag of e.features.tags) knownTags.add(tag);
  }

  if (pin) {
    const development = isDevelopment(features, knownTerms, knownTags);
    const age = item.timestamp - pin.pin.timestamp;
    const timeDecay = Math.max(MIN_TIME_DECAY, 0.5 ** (age / PIN_HALF_LIFE_MS));
    const novelty = development
      ? Math.max(DEVELOPMENT_FLOOR, timeDecay)
      : timeDecay / (1 + related.length);
    const raw =
      Math.max(features.base, PIN_FLOOR) +
      PIN_BOOST * Math.min(1, pinSimilarity / PIN_SIMILARITY_FULL);
    return result(raw * novelty, features.tags, pin.pin.id, !development);
  }

  if (related.length === 0) return result(features.base, features.tags, null, false);
  const development = isDevelopment(features, knownTerms, knownTags);
  const novelty = development ? 1 : 1 / (1 + related.length);
  return result(features.base * novelty, features.tags, null, !development);
}

export interface NewsRelevanceEngineOptions {
  history: (fromMs: number, toMs: number) => readonly ScorableHeadline[];
  pins: () => readonly NewsPin[];
  pinsVersion: () => number;
}

const FEATURE_CACHE_MAX = 20_000;
const SCORE_CACHE_MAX = 5_000;

export class NewsRelevanceEngine {
  private readonly features = new Map<string, HeadlineFeatures>();
  private readonly scores = new Map<string, NewsRelevance>();
  private scoredVersion = -1;

  constructor(private readonly options: NewsRelevanceEngineOptions) {}

  annotate<T extends ScorableHeadline>(items: readonly T[]): (T & { relevance: NewsRelevance })[] {
    const version = this.options.pinsVersion();
    if (version !== this.scoredVersion) {
      this.scores.clear();
      this.scoredVersion = version;
    }

    const missing = items.filter((item) => !this.scores.has(item.id));
    if (missing.length > 0) this.scoreBatch(missing);

    return items.map((item) => ({ ...item, relevance: this.scores.get(item.id)! }));
  }

  private featuresOf(item: Pick<ScorableHeadline, 'id' | 'text' | 'handle'>): HeadlineFeatures {
    let features = this.features.get(item.id);
    if (!features) {
      if (this.features.size >= FEATURE_CACHE_MAX) this.features.clear();
      features = headlineFeatures(item);
      this.features.set(item.id, features);
    }
    return features;
  }

  private scoreBatch(items: readonly ScorableHeadline[]): void {
    let from = Infinity;
    let to = -Infinity;
    for (const item of items) {
      from = Math.min(from, item.timestamp - REPEAT_WINDOW_MS);
      to = Math.max(to, item.timestamp);
    }

    const pool = new Map<string, ScorableHeadline>();
    for (const item of this.options.history(from, to)) pool.set(item.id, item);
    for (const item of items) pool.set(item.id, item);
    const timeline: RelevanceContextEntry[] = [...pool.values()]
      .sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((item) => ({ item, features: this.featuresOf(item) }));
    const index = new Map(timeline.map((entry, i) => [entry.item.id, i]));
    const postings = new Map<string, number[]>();
    timeline.forEach((entry, i) => {
      for (const term of entry.features.terms) {
        const list = postings.get(term);
        if (list) list.push(i);
        else postings.set(term, [i]);
      }
    });

    const pins: PinContext[] = this.options
      .pins()
      .map((pin) => ({ pin, features: this.featuresOf({ ...pin, id: `pin:${pin.id}` }) }));
    const pinNeighbours = new Set<number>();
    for (const pin of pins) {
      for (const i of sharingTwoTerms(pin.features.terms, postings, timeline.length)) {
        pinNeighbours.add(i);
      }
    }

    if (this.scores.size + items.length > SCORE_CACHE_MAX) this.scores.clear();
    for (const item of items) {
      const at = index.get(item.id)!;
      const since = item.timestamp - REPEAT_WINDOW_MS;
      // similarity() is zero below two shared terms, so nothing else can be related.
      const candidates = new Set(sharingTwoTerms(timeline[at]!.features.terms, postings, at));
      for (const i of pinNeighbours) if (i < at) candidates.add(i);
      const earlier = [...candidates]
        .filter((i) => timeline[i]!.item.timestamp >= since)
        .sort((a, b) => a - b)
        .map((i) => timeline[i]!);
      this.scores.set(item.id, scoreHeadline(timeline[at]!, earlier, pins));
    }
  }
}

function sharingTwoTerms(
  terms: Set<string>,
  postings: Map<string, number[]>,
  before: number,
): number[] {
  const shared = new Map<number, number>();
  const out: number[] = [];
  for (const term of terms) {
    for (const i of postings.get(term) ?? []) {
      if (i >= before) break;
      const count = (shared.get(i) ?? 0) + 1;
      shared.set(i, count);
      if (count === 2) out.push(i);
    }
  }
  return out;
}
