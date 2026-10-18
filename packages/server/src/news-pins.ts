import { type DeferredLog, readJsonLines, rewriteJsonLines } from '@oggregator/db';
import { NEWS_PIN_LIMIT, type NewsPin, NewsPinSchema } from '@oggregator/protocol';

export type AddPinResult = 'added' | 'exists' | 'full';

// Pins change a few times a day at most, so they live in a local file next to the news cache
// instead of costing a Postgres write each time.
export class NewsPinStore {
  private pins: NewsPin[];
  private revision = 0;

  constructor(
    private readonly path: string,
    log: DeferredLog,
  ) {
    this.pins = readJsonLines(path, (value) => NewsPinSchema.parse(value), log).slice(
      0,
      NEWS_PIN_LIMIT,
    );
  }

  get version(): number {
    return this.revision;
  }

  list(): readonly NewsPin[] {
    return this.pins;
  }

  add(pin: NewsPin): AddPinResult {
    if (this.pins.some((p) => p.id === pin.id)) return 'exists';
    if (this.pins.length >= NEWS_PIN_LIMIT) return 'full';
    this.commit([...this.pins, pin]);
    return 'added';
  }

  remove(id: string): boolean {
    const next = this.pins.filter((p) => p.id !== id);
    if (next.length === this.pins.length) return false;
    this.commit(next);
    return true;
  }

  private commit(next: NewsPin[]): void {
    rewriteJsonLines(this.path, next, (pin) => pin);
    this.pins = next;
    this.revision++;
  }
}
