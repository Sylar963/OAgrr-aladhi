import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { OPTIONS_LIBRARY_SCHEMA } from '../assistant-market/options-library.js';

interface BookMetadata {
  title: string;
  author: string | null;
  language: string;
}

const KNOWN_BOOKS: Record<string, BookMetadata> = {
  'Volatility+Trading+-+Euan+Sinclair.pdf': {
    title: 'Volatility Trading',
    author: 'Euan Sinclair',
    language: 'en',
  },
  'Colin_Bennett_Trading_Volatility_Trading_Volatility,_Correlation.pdf': {
    title: 'Trading Volatility, Correlation, Term Structure and Skew',
    author: 'Colin Bennett',
    language: 'en',
  },
  'Casanovas_Ramón,_Montserrat_Opciones_financieras_7a_ed_Larousse.pdf': {
    title: 'Opciones financieras (7a ed.)',
    author: 'Montserrat Casanovas Ramón',
    language: 'es',
  },
  'Sheldon_Natenberg_Option_Volatility_&_Pricing_Advanced_Trading_Strategies.pdf': {
    title: 'Option Volatility & Pricing',
    author: 'Sheldon Natenberg',
    language: 'en',
  },
};

const MIN_PAGE_CHARS = 80;
const TARGET_CHUNK_CHARS = 1_500;

function metadataFor(fileName: string): BookMetadata {
  return (
    KNOWN_BOOKS[fileName] ?? {
      title: fileName.replace(/\.pdf$/i, '').replace(/[_+]+/g, ' '),
      author: null,
      language: 'en',
    }
  );
}

function normalizePageText(raw: string): string {
  return raw
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkPageText(text: string): string[] {
  if (text.length <= TARGET_CHUNK_CHARS * 1.3) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of text.split(/\n\n|(?<=[.!?])\s+/)) {
    if (current.length + paragraph.length > TARGET_CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += `${paragraph} `;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function extractPages(file: string): Promise<string[]> {
  const loadingTask = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const raw = content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
      .join('');
    pages.push(normalizePageText(raw));
    page.cleanup();
  }
  await loadingTask.destroy();
  return pages;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '../../../..');
  const sourceDir = resolve(process.env['OPTIONS_LIBRARY_SOURCE_DIR'] ?? resolve(repoRoot, 'docs'));
  const outputPath = resolve(
    process.env['OPTIONS_LIBRARY_PATH'] ?? resolve(repoRoot, 'docs/options-library.sqlite'),
  );
  const files = readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .map((name) => resolve(sourceDir, name));

  rmSync(outputPath, { force: true });
  const database = new DatabaseSync(outputPath);
  database.exec(OPTIONS_LIBRARY_SCHEMA);
  const insertBook = database.prepare(
    'INSERT INTO books (title, author, language, file_name, pdf_pages, indexed_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  );
  const insertPassage = database.prepare(
    'INSERT INTO passages (text, book_id, pdf_page) VALUES (?, ?, ?)',
  );

  for (const file of files) {
    const fileName = basename(file);
    let pages: string[];
    try {
      pages = await extractPages(file);
    } catch (error) {
      process.stdout.write(
        `SKIP ${fileName}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      continue;
    }
    const textPages = pages.filter((page) => page.length >= MIN_PAGE_CHARS).length;
    if (textPages === 0) {
      process.stdout.write(`SKIP ${fileName}: no extractable text (scanned PDF needs OCR)\n`);
      continue;
    }
    const metadata = metadataFor(fileName);
    database.exec('BEGIN');
    const book = insertBook.get(
      metadata.title,
      metadata.author,
      metadata.language,
      fileName,
      pages.length,
      new Date().toISOString(),
    );
    const bookId = Number(book?.['id']);
    let passages = 0;
    pages.forEach((page, index) => {
      if (page.length < MIN_PAGE_CHARS) return;
      for (const chunk of chunkPageText(page)) {
        insertPassage.run(chunk, bookId, index + 1);
        passages += 1;
      }
    });
    database.exec('COMMIT');
    process.stdout.write(
      `OK   ${metadata.title}: ${pages.length} pages, ${textPages} with text, ${passages} passages\n`,
    );
  }
  database.exec("INSERT INTO passages(passages) VALUES('optimize')");
  database.close();
  process.stdout.write(`Library written to ${outputPath}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
