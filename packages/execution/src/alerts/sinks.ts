import type { LiveAlert } from '@oggregator/protocol';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AlertSink {
  readonly name: 'telegram' | 'email';
  send(alert: LiveAlert): Promise<void>;
}

const SEND_TIMEOUT_MS = 10_000;

/** Alert text carries no keys, account numbers or positions; details stay in the journal. */
export function alertText(alert: LiveAlert): string {
  return `[${alert.severity.toUpperCase()}] ${alert.event}\n${alert.message}\n${alert.ts}`;
}

async function post(fetchFn: FetchLike, url: string, init: RequestInit, label: string) {
  const response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
}

/** Send-only: the bot never reads updates, so nothing can be commanded through Telegram. */
export class TelegramSink implements AlertSink {
  readonly name = 'telegram' as const;

  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async send(alert: LiveAlert): Promise<void> {
    await post(
      this.fetchFn,
      `https://api.telegram.org/bot${this.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: alertText(alert),
          disable_web_page_preview: true,
        }),
      },
      'telegram',
    );
  }
}

export class ResendSink implements AlertSink {
  readonly name = 'email' as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly to: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async send(alert: LiveAlert): Promise<void> {
    await post(
      this.fetchFn,
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          // Resend dedupes on this for 24h, so a retry after a timeout doesn't send twice.
          'idempotency-key': alert.id,
        },
        body: JSON.stringify({
          from: this.from,
          to: [this.to],
          subject: `[oggregator ${alert.severity}] ${alert.event}`,
          text: alertText(alert),
        }),
      },
      'resend',
    );
  }
}
