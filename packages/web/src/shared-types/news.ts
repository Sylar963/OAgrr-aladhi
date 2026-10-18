import type { NewsRelevance } from '@oggregator/protocol';

export interface NewsItem {
  id: string;
  text: string;
  url: string;
  source: string;
  handle: string | null;
  ruleTag: string | null;
  timestamp: number;
  classification: 'GOOD' | 'BAD';
  createdAt: string;
  relevance?: NewsRelevance;
}

export interface SpotItem {
  symbol: string;
  lastPrice: number;
  change24hPct: number;
  updatedAt: number;
}
