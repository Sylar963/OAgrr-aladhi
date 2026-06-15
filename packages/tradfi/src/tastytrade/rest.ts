import type { AccessTokenProvider } from './auth.js';
import {
  MarketDataResponseSchema,
  NestedChainResponseSchema,
  QuoteTokenResponseSchema,
  type MarketDatum,
  type NestedChainResponse,
} from './types.js';

export interface RestConfig {
  baseUrl: string;
  userAgent: string;
}

export interface QuoteToken {
  token: string;
  dxlinkUrl: string;
  expiresAt: string | null;
}

export interface MarketDataParams {
  equity?: string[];
  equityOption?: string[];
  index?: string[];
}

export class TastytradeRest {
  constructor(
    private readonly cfg: RestConfig,
    private readonly auth: AccessTokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string, search?: URLSearchParams): Promise<unknown> {
    const token = await this.auth.getAccessToken();
    const url = `${this.cfg.baseUrl}${path}${search ? `?${search.toString()}` : ''}`;
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': this.cfg.userAgent,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`tastytrade GET ${path} -> ${res.status} ${text}`);
    }
    return res.json();
  }

  async getQuoteToken(): Promise<QuoteToken> {
    const parsed = QuoteTokenResponseSchema.safeParse(await this.get('/api-quote-tokens'));
    if (!parsed.success) throw new Error(`quote-token unparseable: ${parsed.error.message}`);
    return {
      token: parsed.data.data.token,
      dxlinkUrl: parsed.data.data['dxlink-url'],
      expiresAt: parsed.data.data['expires-at'] ?? null,
    };
  }

  async getNestedChain(symbol: string): Promise<NestedChainResponse['data']> {
    const parsed = NestedChainResponseSchema.safeParse(
      await this.get(`/option-chains/${encodeURIComponent(symbol)}/nested`),
    );
    if (!parsed.success) throw new Error(`nested chain ${symbol} unparseable: ${parsed.error.message}`);
    return parsed.data.data;
  }

  async getMarketData(params: MarketDataParams): Promise<MarketDatum[]> {
    const search = new URLSearchParams();
    for (const s of params.equity ?? []) search.append('equity', s);
    for (const s of params.equityOption ?? []) search.append('equity-option', s);
    for (const s of params.index ?? []) search.append('index', s);
    const parsed = MarketDataResponseSchema.safeParse(await this.get('/market-data/by-type', search));
    if (!parsed.success) throw new Error(`market-data unparseable: ${parsed.error.message}`);
    return parsed.data.data.items;
  }
}
