import {
  BotMarketResponseSchema,
  NewsEventsResponseSchema,
  NewsStreamMessageSchema,
  ServerWsMessageSchema,
} from '../packages/protocol/dist/index.js';

const base = (process.argv[2] ?? 'https://api.oggregator.xyz')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');
const checks = [];
async function request(path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(`Non-JSON response for ${path}`);
  return response.json();
}
async function check(name, work) {
  try {
    checks.push({ name, available: true, details: await work() });
  } catch (error) {
    checks.push({
      name,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
function stream(path, schema, subscription, accept) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('WebSocket response timeout')), 15_000);
    socket.addEventListener('open', () => {
      if (subscription) socket.send(JSON.stringify(subscription));
    });
    socket.addEventListener('error', () => finish(new Error('WebSocket connection failed')));
    socket.addEventListener('close', () =>
      finish(new Error('WebSocket closed before expected data')),
    );
    socket.addEventListener('message', (event) => {
      try {
        const frame = schema.parse(JSON.parse(String(event.data)));
        if (frame.type === 'error') finish(new Error(`WebSocket ${frame.code}`));
        else if (accept(frame)) finish(null, frame);
      } catch (error) {
        finish(error);
      }
    });
  });
}

await check('readiness', async () => request('/api/ready'));
await check('schemas', async () => {
  const schemas = await request('/api/bot/schema');
  if (!schemas.market || !schemas.newsEvents || !schemas.newsWebSocket)
    throw new Error('Missing bot schemas');
  return Object.keys(schemas);
});
let status;
await check('bot status', async () => {
  status = await request('/api/bot/status');
  if (!status.news?.health?.ready) throw new Error('News transport is not fresh');
  return {
    venues: status.marketVenues,
    news: status.news.health,
    capabilities: status.capabilities,
  };
});
let page;
await check('news replay', async () => {
  page = NewsEventsResponseSchema.parse(await request('/api/news/events?limit=1'));
  return {
    count: page.events.length,
    oldestCursor: page.oldestCursor,
    cursor: page.nextCursor,
    hasMore: page.hasMore,
  };
});
await check('news websocket', async () => {
  const cursor = page?.oldestCursor ?? status?.news?.cursor;
  const frame = await stream(
    `/ws/news${cursor ? `?after=${encodeURIComponent(cursor)}` : ''}`,
    NewsStreamMessageSchema,
    null,
    (frame) => (page?.events.length ? frame.type === 'events' : frame.type === 'subscribed'),
  );
  return { type: frame.type };
});
let requests = [];
await check('expiry discovery', async () => {
  const expiries = await request('/api/expiries?underlying=BTC');
  if (!Array.isArray(expiries.byVenue)) throw new Error('Missing per-venue expiries');
  requests = expiries.byVenue.flatMap((entry) => {
    const expiry =
      entry.expiries.find((value) => Date.parse(`${value}T00:00:00Z`) > Date.now() + 86_400_000) ??
      entry.expiries.at(-1);
    return expiry ? [{ venue: entry.venue, expiry }] : [];
  });
  if (requests.length === 0) throw new Error('No BTC market requests available');
  return requests;
});
for (const market of requests) {
  await check(`BTC ${market.venue}`, async () => {
    const params = new URLSearchParams({
      underlying: 'BTC',
      expiry: market.expiry,
      venues: market.venue,
    });
    const result = BotMarketResponseSchema.parse(await request(`/api/bot/market?${params}`));
    if (result.venues[0]?.quotes === 0) throw new Error('No option quotes returned');
    return { dataReady: result.dataReady, ...result.venues[0], failedVenues: result.failedVenues };
  });
}
if (requests[0])
  await check('chain websocket', async () => {
    const request = { underlying: 'BTC', expiry: requests[0].expiry, venues: [requests[0].venue] };
    const frame = await stream(
      '/ws/chain',
      ServerWsMessageSchema,
      { type: 'subscribe', subscriptionId: 'api-readiness-check', request },
      (frame) => frame.type === 'snapshot',
    );
    return { type: frame.type, seq: frame.seq, meta: frame.meta };
  });
process.stdout.write(
  `${JSON.stringify({ base, checkedAt: new Date().toISOString(), checks }, null, 2)}\n`,
);
process.exitCode = checks.some((check) => !check.available) ? 1 : 0;
