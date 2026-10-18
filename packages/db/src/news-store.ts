import type { Pool } from 'pg';
import { createPgPool } from './pg-pool.js';

const INSERT_BATCH_SIZE = 500;
const COLUMNS_PER_ROW = 8;

export interface PersistedNewsItem {
  id: string;
  publishedAt: Date;
  ingestedAt: Date;
  text: string;
  url: string;
  source: string;
  handle: string | null;
  ruleTag: string | null;
}

export interface NewsCursor {
  publishedAt: Date;
  id: string;
}

export interface NewsPageQuery {
  since: Date;
  before: NewsCursor | null;
  limit: number;
}

export interface NewsStore {
  readonly enabled: boolean;
  writeMany(rows: PersistedNewsItem[]): Promise<void>;
  loadPage(query: NewsPageQuery): Promise<PersistedNewsItem[]>;
  prune(before: Date): Promise<number>;
  dispose(): Promise<void>;
}

export class NoopNewsStore implements NewsStore {
  readonly enabled = false;
  async writeMany(): Promise<void> {}
  async loadPage(): Promise<PersistedNewsItem[]> {
    return [];
  }
  async prune(): Promise<number> {
    return 0;
  }
  async dispose(): Promise<void> {}
}

export class PostgresNewsStore implements NewsStore {
  readonly enabled = true;

  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresNewsStore {
    return new PostgresNewsStore(createPgPool({ connectionString }));
  }

  async writeMany(rows: PersistedNewsItem[]): Promise<void> {
    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((row, batchIndex) => {
        const offset = batchIndex * COLUMNS_PER_ROW;
        values.push(
          row.id,
          row.publishedAt,
          row.ingestedAt,
          row.text,
          row.url,
          row.source,
          row.handle,
          row.ruleTag,
        );
        const slots = Array.from({ length: COLUMNS_PER_ROW }, (_, i) => `$${offset + i + 1}`);
        return `(${slots.join(', ')})`;
      });
      await this.pool.query(
        `INSERT INTO news_items (id, published_at, ingested_at, text, url, source, handle, rule_tag)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values,
      );
    }
  }

  async loadPage({ since, before, limit }: NewsPageQuery): Promise<PersistedNewsItem[]> {
    const values: unknown[] = [since];
    let cursorClause = '';
    if (before) {
      values.push(before.publishedAt, before.id);
      cursorClause = 'AND (published_at, id) < ($2, $3)';
    }
    values.push(limit);
    const result = await this.pool.query<NewsItemRow>(
      `SELECT id, published_at, ingested_at, text, url, source, handle, rule_tag
       FROM news_items
       WHERE published_at >= $1 ${cursorClause}
       ORDER BY published_at DESC, id DESC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(mapRow);
  }

  async prune(before: Date): Promise<number> {
    const result = await this.pool.query('DELETE FROM news_items WHERE published_at < $1', [
      before,
    ]);
    return result.rowCount ?? 0;
  }

  async dispose(): Promise<void> {
    await this.pool.end();
  }
}

interface NewsItemRow {
  id: string;
  published_at: Date;
  ingested_at: Date;
  text: string;
  url: string;
  source: string;
  handle: string | null;
  rule_tag: string | null;
}

function mapRow(row: NewsItemRow): PersistedNewsItem {
  return {
    id: row.id,
    publishedAt: row.published_at,
    ingestedAt: row.ingested_at,
    text: row.text,
    url: row.url,
    source: row.source,
    handle: row.handle,
    ruleTag: row.rule_tag,
  };
}
