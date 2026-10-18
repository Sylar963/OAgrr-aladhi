import type { NewsPin } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';
import {
  headlineFeatures,
  NewsRelevanceEngine,
  type ScorableHeadline,
  similarity,
  keyTerms,
} from './news-relevance.js';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-10-18T12:00:00.000Z');

function headline(id: string, text: string, handle: string | null, at: number): ScorableHeadline {
  return { id, text, handle, timestamp: at };
}

function engine(history: ScorableHeadline[], pins: NewsPin[] = []) {
  let version = 0;
  const state = { pins };
  const instance = new NewsRelevanceEngine({
    history: (from, to) => history.filter((h) => h.timestamp >= from && h.timestamp <= to),
    pins: () => state.pins,
    pinsVersion: () => version,
  });
  return {
    instance,
    setPins(next: NewsPin[]) {
      state.pins = next;
      version++;
    },
  };
}

function pinOf(item: ScorableHeadline): NewsPin {
  return { ...item, url: `https://x.com/i/${item.id}`, pinnedAt: item.timestamp };
}

function score(items: ScorableHeadline[], pins: NewsPin[] = []) {
  const results = engine(items, pins).instance.annotate(items);
  return new Map(results.map((r) => [r.id, r.relevance]));
}

describe('dictionary scoring', () => {
  const feed = [
    headline(
      'drone',
      'UKRAINIAN DRONE ATTACK REPORTED IN ST. PETERSBURG, WITH EXPLOSIONS LIGHTING UP NIGHT SKY',
      'FirstSquawk',
      T0,
    ),
    headline(
      'boc',
      'BANK OF CANADA GOVERNOR: RISING GLOBAL ENERGY COSTS COULD COMPLICATE INFLATION OUTLOOK - BNNBloomberg',
      'FirstSquawk',
      T0 + 1,
    ),
    headline(
      'lebanon',
      'LEBANESE MILITARY DELEGATION TO PUSH FOR CESSATION OF ISRAELI ATTACKS AT US MEETING',
      'FirstSquawk',
      T0 + 2,
    ),
    headline('grok', 'Our team makes around around 20 improvements per day to Grok @Bot', 'elonmusk', T0 + 3),
    headline(
      'cars',
      'The average car on the road in America is now nearly 13 years old, an all-time high, per Charlie Bilello.',
      'unusual_whales',
      T0 + 4,
    ),
    headline('anthropic', 'ANTHROPIC IPO DELAYED AFTER BOARD REVIEW - SOURCES', 'DeItaone', T0 + 5),
    headline('hack', 'Exchange XYZ hacked, $120M drained from hot wallet', 'WuBlockchain', T0 + 6),
    headline('cpi', 'US CPI 3.4% Y/Y VS 3.2% EXPECTED', 'FirstSquawk', T0 + 7),
  ];
  const r = score(feed);

  it('flags war, hacks, macro prints and watched-company events red', () => {
    expect(r.get('drone')?.tier).toBe('critical');
    expect(r.get('drone')?.tags[0]).toBe('war');
    expect(r.get('hack')?.tier).toBe('critical');
    expect(r.get('cpi')).toMatchObject({ tier: 'critical', tags: ['macro-data'] });
    expect(r.get('anthropic')?.tier).toBe('critical');
    expect(r.get('anthropic')?.tags).toEqual(expect.arrayContaining(['corporate', 'ipo']));
  });

  it('marks central-bank commentary and conflict talk yellow', () => {
    expect(r.get('boc')?.tier).toBe('watch');
    expect(r.get('lebanon')?.tier).toBe('watch');
  });

  it('leaves noise unflagged', () => {
    expect(r.get('grok')).toMatchObject({ tier: 'normal', score: 0, tags: [] });
    expect(r.get('cars')?.tier).toBe('normal');
  });

  it('requires an event verb before a watched company counts', () => {
    expect(headlineFeatures({ text: 'Anthropic ships a new model', handle: null }).tags).toEqual([]);
  });
});

describe('repeats', () => {
  it('damps a retelling of a story that already ran', () => {
    const first = headline(
      'a',
      'UKRAINIAN DRONE ATTACK REPORTED IN ST. PETERSBURG, WITH EXPLOSIONS LIGHTING UP NIGHT SKY',
      'FirstSquawk',
      T0,
    );
    const again = headline(
      'b',
      'Explosions reported in St. Petersburg after Ukrainian drone attack, night sky lit up',
      'business',
      T0 + 20 * 60_000,
    );
    const r = score([first, again]);
    expect(r.get('a')).toMatchObject({ tier: 'critical', repeat: false });
    expect(r.get('b')?.repeat).toBe(true);
    expect(r.get('b')!.score).toBeLessThan(r.get('a')!.score / 1.5);
  });

  it('keeps a follow-up that brings a new figure', () => {
    const first = headline('a', 'DRONE ATTACK ON ST. PETERSBURG REFINERY, EXPLOSIONS HEARD', 'FirstSquawk', T0);
    const update = headline(
      'b',
      'DRONE ATTACK ON ST. PETERSBURG REFINERY: 12 KILLED, EXPLOSIONS CONTINUE',
      'FirstSquawk',
      T0 + 10 * 60_000,
    );
    const r = score([first, update]);
    expect(r.get('b')).toMatchObject({ repeat: false, tier: 'critical' });
  });

  it('only looks back across the repeat window', () => {
    const first = headline('a', 'US CPI 3.4% Y/Y VS 3.2% EXPECTED', 'FirstSquawk', T0);
    const nextMonth = headline('b', 'US CPI 3.4% Y/Y VS 3.2% EXPECTED', 'FirstSquawk', T0 + 30 * 24 * HOUR);
    expect(score([first, nextMonth]).get('b')?.repeat).toBe(false);
  });
});

describe('pins', () => {
  const pinned = headline(
    'pin',
    'ANTHROPIC IPO DELAYED AFTER BOARD REVIEW - SOURCES',
    'DeItaone',
    T0,
  );

  it('ranks the pinned headline itself red', () => {
    const r = score([pinned], [pinOf(pinned)]);
    expect(r.get('pin')).toMatchObject({ tier: 'critical', pinId: 'pin', repeat: false });
  });

  it('lifts related headlines that the dictionary alone would miss', () => {
    const related = headline('rel', 'Anthropic board review continues, people familiar say', 'business', T0 + HOUR);
    expect(score([pinned, related]).get('rel')?.tier).toBe('normal');
    const r = score([pinned, related], [pinOf(pinned)]);
    expect(r.get('rel')).toMatchObject({ pinId: 'pin', tier: 'watch' });
  });

  it('decays retellings with time since the pin and with each repeat', () => {
    const soon = headline('soon', 'Anthropic IPO delayed after board review', 'business', T0 + 30 * 60_000);
    const later = headline('later', 'Anthropic IPO delayed following board review', 'Reuters', T0 + 12 * HOUR);
    const r = score([pinned, soon, later], [pinOf(pinned)]);
    expect(r.get('soon')).toMatchObject({ pinId: 'pin', repeat: true });
    expect(r.get('later')).toMatchObject({ pinId: 'pin', repeat: true, tier: 'normal' });
    expect(r.get('later')!.score).toBeLessThan(r.get('soon')!.score);
  });

  it('lets a real development through long after the pin', () => {
    const development = headline(
      'dev',
      'ANTHROPIC IPO DELAYED TO 2027, VALUATION CUT TO $250B',
      'DeItaone',
      T0 + 12 * HOUR,
    );
    const r = score([pinned, development], [pinOf(pinned)]);
    expect(r.get('dev')).toMatchObject({ pinId: 'pin', repeat: false });
    expect(r.get('dev')!.tier).not.toBe('normal');
  });

  it('rescoring follows pin changes', () => {
    const related = headline('rel', 'Anthropic board review continues, people familiar say', 'business', T0 + HOUR);
    const e = engine([pinned, related]);
    expect(e.instance.annotate([related])[0]!.relevance.pinId).toBeNull();
    e.setPins([pinOf(pinned)]);
    expect(e.instance.annotate([related])[0]!.relevance.pinId).toBe('pin');
  });
});

describe('terms', () => {
  it('ignores links, stopwords and plural endings', () => {
    const terms = keyTerms('Drone attacks reported in the city https://t.co/abc');
    expect([...terms]).toEqual(['drone', 'attack', 'city']);
  });

  it('needs at least two shared terms to call two headlines related', () => {
    expect(similarity(keyTerms('Bitcoin rallies'), keyTerms('Bitcoin dumps hard'))).toBe(0);
  });
});
