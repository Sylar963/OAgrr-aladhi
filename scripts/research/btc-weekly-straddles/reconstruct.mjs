// Rebuilds weekly Deribit BTC ATM straddle marks from public trade history.
// Usage: node reconstruct.mjs [entryHourUtc=8] [exitOffsetHours=8]
//   Entry is Friday at entryHourUtc. Exit is Friday + 3 days + exitOffsetHours (8 → Monday 08:00).
// Output: .cache/perp_hourly.json (shared) and .cache/weekend_e{entry}_x{exit}.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const H = 3_600_000;
const D = 24 * H;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const START = Date.UTC(2021, 0, 1);
const END = Date.UTC(2026, 9, 2);
const ENTRY_H = Number(process.argv[2] ?? 8);
const EXIT_H = Number(process.argv[3] ?? 8);

fs.mkdirSync(CACHE, { recursive: true });

async function get(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status !== 429) {
        const body = await response.json();
        if (body.result !== undefined) return body.result;
      }
    } catch {
      // retried below
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  return null;
}

async function perpHourly() {
  const file = path.join(CACHE, 'perp_hourly.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const closes = new Map();
  for (let from = START - 200 * D; from < END + 8 * D; from += 60 * D) {
    const to = Math.min(END + 8 * D, from + 60 * D);
    const result = await get(
      `https://www.deribit.com/api/v2/public/get_tradingview_chart_data?instrument_name=BTC-PERPETUAL&resolution=60&start_timestamp=${from}&end_timestamp=${to}`,
    );
    result?.ticks.forEach((ts, index) => closes.set(ts, result.close[index]));
  }
  const sorted = [...closes.entries()].sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(file, JSON.stringify(sorted));
  return sorted;
}

function cdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function black76(F, K, T, vol, call) {
  if (T <= 0 || vol <= 0) return Math.max(0, call ? F - K : K - F);
  const sd = vol * Math.sqrt(T);
  const d1 = (Math.log(F / K) + (sd * sd) / 2) / sd;
  const d2 = d1 - sd;
  return call ? F * cdf(d1) - K * cdf(d2) : K * cdf(-d2) - F * cdf(-d1);
}

function impliedVol(price, F, K, T, call) {
  let low = 0.01;
  let high = 5;
  if (!(price > black76(F, K, T, low, call)) || price > black76(F, K, T, high, call)) return null;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (black76(F, K, T, mid, call) > price) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

function instrument(expiryTs, strike, right) {
  const date = new Date(expiryTs);
  const yy = String(date.getUTCFullYear()).slice(2);
  return `BTC-${date.getUTCDate()}${MONTHS[date.getUTCMonth()]}${yy}-${strike}-${right}`;
}

// Median IV implied by Deribit's mark price on each trade in the window.
async function legMarkIv(name, strike, expiryTs, from, to) {
  const result = await get(
    `https://history.deribit.com/api/v2/public/get_last_trades_by_instrument_and_time?instrument_name=${name}&start_timestamp=${from}&end_timestamp=${to}&count=100&sorting=asc`,
  );
  const call = name.endsWith('-C');
  const ivs = (result?.trades ?? [])
    .map((trade) =>
      impliedVol(
        trade.mark_price * trade.index_price,
        trade.index_price,
        strike,
        (expiryTs - trade.timestamp) / (365 * D),
        call,
      ),
    )
    .filter((iv) => iv != null)
    .sort((a, b) => a - b);
  return ivs.length === 0 ? null : ivs[Math.floor(ivs.length / 2)];
}

const pairIv = (call, put) => (call != null && put != null ? (call + put) / 2 : (call ?? put));

async function week(friday, priceAt) {
  const label = new Date(friday).toISOString().slice(0, 10);
  const entryTs = friday + ENTRY_H * H;
  const exitTs = friday + 3 * D + EXIT_H * H;
  const expiryTs = friday + 7 * D + 8 * H;
  const S0 = priceAt(entryTs);
  const S1 = priceAt(exitTs);
  if (!S0 || !S1) return { fri: label, skip: 'no_spot' };
  const strike = Math.round(S0 / 1_000) * 1_000;
  const [c0, p0] = await Promise.all([
    legMarkIv(instrument(expiryTs, strike, 'C'), strike, expiryTs, entryTs, entryTs + 3 * H),
    legMarkIv(instrument(expiryTs, strike, 'P'), strike, expiryTs, entryTs, entryTs + 3 * H),
  ]);
  const iv0 = pairIv(c0, p0);
  if (iv0 == null) return { fri: label, skip: 'no_entry_trades' };
  const [c1, p1] = await Promise.all([
    legMarkIv(instrument(expiryTs, strike, 'C'), strike, expiryTs, exitTs, exitTs + 4 * H),
    legMarkIv(instrument(expiryTs, strike, 'P'), strike, expiryTs, exitTs, exitTs + 4 * H),
  ]);
  const iv1 = pairIv(c1, p1);
  if (iv1 == null) return { fri: label, skip: 'no_exit_trades' };
  const T0 = (expiryTs - entryTs) / (365 * D);
  const T1 = (expiryTs - exitTs) / (365 * D);
  const straddle = (S, T, vol) => black76(S, strike, T, vol, true) + black76(S, strike, T, vol, false);
  const V0 = straddle(S0, T0, iv0);
  const V1 = straddle(S1, T1, iv1);
  const V1ConstIv = straddle(S1, T1, iv0);
  const V1Flat = straddle(S0, T1, iv0);
  return {
    fri: label,
    K: strike,
    S0,
    S1,
    ST: priceAt(expiryTs) ?? null,
    iv0,
    iv1,
    V0,
    V1,
    pnlMid: V0 - V1,
    theta: V0 - V1Flat,
    gamma: V1Flat - V1ConstIv,
    vega: V1ConstIv - V1,
  };
}

const perp = await perpHourly();
const closes = new Map(perp);
const priceAt = (ts) => closes.get(Math.floor(ts / H) * H);
const fridays = [];
for (let t = START; t < END - 3 * D; t += D) if (new Date(t).getUTCDay() === 5) fridays.push(t);

const rows = [];
for (let i = 0; i < fridays.length; i += 8) {
  rows.push(...(await Promise.all(fridays.slice(i, i + 8).map((friday) => week(friday, priceAt)))));
  process.stderr.write(`\r${Math.min(i + 8, fridays.length)}/${fridays.length} weeks`);
}
const out = path.join(CACHE, `weekend_e${ENTRY_H}_x${EXIT_H}.json`);
fs.writeFileSync(out, JSON.stringify(rows));
process.stderr.write(`\nwrote ${out}\n`);
