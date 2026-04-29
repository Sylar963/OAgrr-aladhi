import {
  TastytradeNestedChainSchema,
  TastytradeQuoteTokenResponseSchema,
  TastytradeSessionResponseSchema,
  type TastytradeNestedChain,
  type TastytradeQuoteTokenResponse,
} from './types.js';

const DEFAULT_BASE = 'https://api.tastytrade.com';

export interface TastytradeAuth {
  username: string;
  password?: string;
  rememberToken?: string;
}

export interface TastytradeSession {
  sessionToken: string;
  rememberToken: string | null;
}

export interface TastytradeRestClientOptions {
  baseUrl?: string;
  userAgent?: string;
}

export class TastytradeRestClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private session: TastytradeSession | null = null;

  constructor(opts: TastytradeRestClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.userAgent = opts.userAgent ?? 'oggregator/0.1';
  }

  async login(_auth: TastytradeAuth): Promise<TastytradeSession> {
    // POST /sessions { login, password|remember-token, remember-me: true }
    // Parses with TastytradeSessionResponseSchema, stores session, returns it.
    void TastytradeSessionResponseSchema;
    throw new Error('TastytradeRestClient.login not implemented');
  }

  async getQuoteToken(): Promise<TastytradeQuoteTokenResponse['data']> {
    // POST /api-quote-tokens with Authorization: <session-token>
    void TastytradeQuoteTokenResponseSchema;
    throw new Error('TastytradeRestClient.getQuoteToken not implemented');
  }

  async getNestedOptionChain(_symbol: string): Promise<TastytradeNestedChain['data']> {
    // GET /option-chains/{symbol}/nested
    void TastytradeNestedChainSchema;
    throw new Error('TastytradeRestClient.getNestedOptionChain not implemented');
  }

  hasSession(): boolean {
    return this.session != null;
  }
}
