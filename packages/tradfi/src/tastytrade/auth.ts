import { OAuthTokenResponseSchema } from './types.js';

export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface OAuth2Config {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const EXPIRY_SKEW_MS = 60_000;

export class OAuth2TokenManager implements AccessTokenProvider {
  private token: string | null = null;
  private expiresAtMs = 0;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly cfg: OAuth2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token != null && Date.now() < this.expiresAtMs - EXPIRY_SKEW_MS) {
      return this.token;
    }
    if (this.inflight != null) return this.inflight;
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.cfg.refreshToken,
      client_secret: this.cfg.clientSecret,
      client_id: this.cfg.clientId,
    });

    const res = await this.fetchImpl(`${this.cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'oggregator-tradfi/0.1',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`oauth token refresh failed: ${res.status} ${text}`);
    }

    const parsed = OAuthTokenResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`oauth token response unparseable: ${parsed.error.message}`);
    }

    this.token = parsed.data.access_token;
    this.expiresAtMs = Date.now() + parsed.data.expires_in * 1000;
    return this.token;
  }
}
