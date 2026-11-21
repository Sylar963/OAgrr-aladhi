import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NewsDeliveryJournal } from '@oggregator/core';
import { afterEach, describe, expect, it } from 'vitest';
import { FileNewsDeliveryStore } from './news-delivery-store.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'bot-news-'));
  directories.push(directory);
  const path = join(directory, 'events.ndjson');
  const store = new FileNewsDeliveryStore(path);
  const journal = new NewsDeliveryJournal(store);
  journal.record([
    {
      id: 'a',
      text: 'BTC',
      url: '',
      source: 'test',
      handle: null,
      ruleTag: null,
      timestamp: 1,
      upstreamCreatedAt: null,
      classification: 'GOOD',
    },
  ]);
  return { path, store, journal };
}

describe('news delivery persistence', () => {
  it('survives restarts and repairs an interrupted final append', () => {
    const { path, store, journal } = setup();
    writeFileSync(path, readFileSync(path, 'utf8') + '{"cursor":');
    const restored = new NewsDeliveryJournal(store);
    expect(restored.cursor).toBe(journal.cursor);
    expect(restored.size).toBe(1);
    expect(readFileSync(path, 'utf8')).toMatch(/}\n$/);
  });

  it('fails closed on corruption in a completed record', () => {
    const { path, store } = setup();
    writeFileSync(path, '{"bad":true}\n' + readFileSync(path, 'utf8'));
    expect(() => new NewsDeliveryJournal(store)).toThrow();
  });
});
