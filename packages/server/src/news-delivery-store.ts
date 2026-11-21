import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { NewsDeliveryJournal, type NewsDeliveryStore } from '@oggregator/core';
import { NewsDeliveryEventSchema, type NewsDeliveryEvent } from '@oggregator/protocol';

export class FileNewsDeliveryStore implements NewsDeliveryStore {
  constructor(private readonly path: string) {}

  read(): NewsDeliveryEvent[] {
    if (!existsSync(this.path)) return [];
    const body = readFileSync(this.path, 'utf8');
    const lines = body.split('\n');
    const events: NewsDeliveryEvent[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        events.push(NewsDeliveryEventSchema.parse(JSON.parse(line)));
      } catch (error) {
        if (index !== lines.length - 1 || body.endsWith('\n')) throw error;
        this.replace(events);
      }
    }
    if (body && !body.endsWith('\n')) this.replace(events);
    return events;
  }

  append(events: NewsDeliveryEvent[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const fd = openSync(this.path, 'a', 0o600);
    try {
      writeFileSync(fd, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  replace(events: NewsDeliveryEvent[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try {
      writeFileSync(fd, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.path);
  }
}

export function createNewsDeliveryJournal() {
  const maxEvents = Number(process.env['NEWS_DELIVERY_MAX_EVENTS'] ?? 50_000);
  return new NewsDeliveryJournal(
    new FileNewsDeliveryStore(process.env['NEWS_DELIVERY_PATH'] ?? '.cache/news-delivery.ndjson'),
    maxEvents,
  );
}
