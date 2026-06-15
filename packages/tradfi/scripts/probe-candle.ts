/**
 * Go/No-Go probe: does the TastyTrade DXLink feed deliver historical Candle
 * (OHLC) bars on this account's entitlement?
 *
 * Reuses the production auth + token + handshake builders; adds only the
 * Candle-specific FEED_SETUP fields and a `fromTime` subscription (the history
 * trigger). Standalone — touches no production code. Run:
 *   cd packages/tradfi && npx tsx --env-file=../../.env scripts/probe-candle.ts
 */
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import { OAuth2TokenManager } from '../src/tastytrade/auth.js';
import { TastytradeRest } from '../src/tastytrade/rest.js';
import { buildSetup, buildAuth, buildChannelRequest, buildKeepalive } from '../src/tastytrade/codec.js';

const CHANNEL = 3;
const RUN_MS = 25_000;
const CANDLE_FIELDS = ['eventType', 'eventSymbol', 'time', 'open', 'high', 'low', 'close', 'volume'];

const sec = (ms: number) => Math.floor(ms / 1000);
const now = Date.now();

// A spread of symbols/periods. If ANY return history, candle data is entitled
// (option candles ride the same entitlement). Underlying candles are also what
// the PnL-attribution forward leg needs.
const SUBS = [
  { type: 'Candle', symbol: 'AAPL{=1d}', fromTime: sec(now - 45 * 86400_000) },
  { type: 'Candle', symbol: 'AAPL{=5m}', fromTime: sec(now - 3 * 86400_000) },
  { type: 'Candle', symbol: 'SPY{=1d}', fromTime: sec(now - 45 * 86400_000) },
  { type: 'Candle', symbol: 'SPX{=5m}', fromTime: sec(now - 3 * 86400_000) },
];

function buildCandleFeedSetup(channel: number) {
  return {
    type: 'FEED_SETUP',
    channel,
    acceptAggregationPeriod: 0.1,
    acceptDataFormat: 'COMPACT' as const,
    acceptEventFields: { Candle: CANDLE_FIELDS },
  };
}

function buildCandleSubscribe(channel: number) {
  return { type: 'FEED_SUBSCRIPTION', channel, add: SUBS };
}

interface Bar { symbol: string; time: number; o: number; h: number; l: number; c: number; v: number }
const bars = new Map<string, Bar[]>();

function ingest(frame: { data?: unknown }) {
  const data = frame.data;
  if (!Array.isArray(data) || data[0] !== 'Candle' || !Array.isArray(data[1])) return;
  const flat = data[1];
  const n = CANDLE_FIELDS.length;
  for (let i = 0; i + n <= flat.length; i += n) {
    const sym = String(flat[i + 1]);
    const bar: Bar = {
      symbol: sym,
      time: Number(flat[i + 2]),
      o: Number(flat[i + 3]), h: Number(flat[i + 4]),
      l: Number(flat[i + 5]), c: Number(flat[i + 6]), v: Number(flat[i + 7]),
    };
    const key = sym.replace(/\{.*/, '');
    if (!bars.has(key)) bars.set(key, []);
    bars.get(key)!.push(bar);
  }
}

async function main() {
  const cfg = loadConfig();
  const auth = new OAuth2TokenManager(cfg);
  const rest = new TastytradeRest({ baseUrl: cfg.baseUrl, userAgent: cfg.userAgent }, auth);

  console.log('[probe] acquiring quote token…');
  const qt = await rest.getQuoteToken();
  console.log(`[probe] dxlink url: ${qt.dxlinkUrl}`);

  const ws = new WebSocket(qt.dxlinkUrl);
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  let sentAuth = false;

  const keepalive = setInterval(() => { if (ws.readyState === ws.OPEN) send(buildKeepalive()); }, 20_000);

  ws.on('open', () => { console.log('[probe] ws open → SETUP'); send(buildSetup()); });

  ws.on('message', (raw: WebSocket.RawData) => {
    let msg: { type?: string; state?: string; error?: string; message?: string; data?: unknown };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'AUTH_STATE':
        if (msg.state === 'UNAUTHORIZED' && !sentAuth) { sentAuth = true; console.log('[probe] AUTH'); send(buildAuth(qt.token)); }
        else if (msg.state === 'AUTHORIZED') { console.log('[probe] AUTHORIZED → CHANNEL_REQUEST'); send(buildChannelRequest(CHANNEL)); }
        return;
      case 'CHANNEL_OPENED': console.log('[probe] CHANNEL_OPENED → FEED_SETUP(Candle)'); send(buildCandleFeedSetup(CHANNEL)); return;
      case 'FEED_CONFIG': console.log('[probe] FEED_CONFIG → SUBSCRIBE(Candle +fromTime)'); send(buildCandleSubscribe(CHANNEL)); return;
      case 'FEED_DATA': ingest(msg); return;
      case 'ERROR': console.log(`[probe] ⚠ ERROR frame: ${msg.error ?? ''} ${msg.message ?? ''}`); return;
      default: return;
    }
  });

  ws.on('error', (e) => console.log(`[probe] ws error: ${String(e)}`));

  setTimeout(() => {
    clearInterval(keepalive);
    ws.close();
    console.log('\n================ VERDICT ================');
    let total = 0;
    for (const [sym, list] of bars) {
      total += list.length;
      list.sort((a, b) => a.time - b.time);
      const f = list[0], l = list[list.length - 1];
      console.log(`  ${sym}: ${list.length} bars | first ${new Date(f!.time).toISOString()} O${f!.o} C${f!.c} | last ${new Date(l!.time).toISOString()} O${l!.o} H${l!.h} L${l!.l} C${l!.c} V${l!.v}`);
    }
    if (total > 0) console.log(`\n✅ GO — ${total} candle bars across ${bars.size} symbols. Candle history IS entitled.`);
    else console.log('\n❌ NO-GO — zero candle bars arrived. Candle history likely not entitled (or wrong subscription format).');
    console.log('=========================================');
    process.exit(0);
  }, RUN_MS);
}

main().catch((e) => { console.error('[probe] fatal:', e); process.exit(1); });
