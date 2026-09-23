import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const OPTIONS_LIBRARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  language TEXT,
  file_name TEXT NOT NULL UNIQUE,
  pdf_pages INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(
  text,
  book_id UNINDEXED,
  pdf_page UNINDEXED,
  tokenize = 'porter unicode61 remove_diacritics 2'
);
`;

export interface OptionsLibraryHit {
  book: string;
  author: string | null;
  pdfPage: number;
  excerpt: string;
}

export interface OptionsLibraryBook {
  title: string;
  author: string | null;
  language: string | null;
  pdfPages: number;
}

const MAX_TERMS = 16;
const EXCERPT_CHARS = 1_600;

export function buildOptionsLibraryMatchQuery(query: string): string | null {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(
    0,
    MAX_TERMS,
  );
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(' OR ');
}

export class OptionsLibrary {
  private database: DatabaseSync | null = null;

  constructor(private readonly path: string) {}

  private open(): DatabaseSync | null {
    if (this.database) return this.database;
    if (!existsSync(this.path)) return null;
    this.database = new DatabaseSync(this.path, { readOnly: true });
    return this.database;
  }

  listBooks(): OptionsLibraryBook[] | null {
    const database = this.open();
    if (!database) return null;
    return database
      .prepare('SELECT title, author, language, pdf_pages FROM books ORDER BY title')
      .all()
      .map((row) => ({
        title: String(row['title']),
        author: row['author'] == null ? null : String(row['author']),
        language: row['language'] == null ? null : String(row['language']),
        pdfPages: Number(row['pdf_pages']),
      }));
  }

  search(query: string, limit: number): OptionsLibraryHit[] | null {
    const database = this.open();
    if (!database) return null;
    const match = buildOptionsLibraryMatchQuery(query);
    if (!match) return [];
    return database
      .prepare(
        `SELECT books.title AS title, books.author AS author, passages.pdf_page AS pdf_page,
                passages.text AS text
           FROM passages JOIN books ON books.id = passages.book_id
          WHERE passages MATCH ?
          ORDER BY bm25(passages)
          LIMIT ?`,
      )
      .all(match, limit)
      .map((row) => ({
        book: String(row['title']),
        author: row['author'] == null ? null : String(row['author']),
        pdfPage: Number(row['pdf_page']),
        excerpt: String(row['text']).slice(0, EXCERPT_CHARS),
      }));
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }
}
