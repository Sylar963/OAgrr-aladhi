// Prints the tables cited in docs/knowledge/options-trading.md from reconstruct.mjs output.
// Usage: node analyze.mjs [entryHourUtc=8] [exitOffsetHours=8]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
const H = 3_600_000;
const D = 24 * H;
const ENTRY_H = Number(process.argv[2] ?? 8);
const EXIT_H = Number(process.argv[3] ?? 8);
// Cost assumptions: Deribit taker 0.03% of spot per leg capped at 12.5% of premium, a 4 bp of
// spot half-spread per leg (assumed, not measured), and a 0.015% settlement fee at expiry.
const TAKER = 0.0003;
const FEE_CAP = 0.125;
const HALF_SPREAD = 0.0004;
const SETTLEMENT = 0.00015;

const perp = JSON.parse(fs.readFileSync(path.join(CACHE, 'perp_hourly.json'), 'utf8'));
const closes = new Map(perp);
const rows = JSON.parse(
  fs.readFileSync(path.join(CACHE, `weekend_e${ENTRY_H}_x${EXIT_H}.json`), 'utf8'),
).filter((row) => !row.skip);

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sd = (values) => {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
};

function summary(label, values) {
  if (values.length < 3) return console.log(`${label.padEnd(40)} n=${values.length}`);
  const m = mean(values);
  const margin = (1.96 * sd(values)) / Math.sqrt(values.length);
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `${label.padEnd(40)} n=${String(values.length).padStart(3)}  mean ${m.toFixed(2)} [${(m - margin).toFixed(2)}, ${(m + margin).toFixed(2)}]  win ${((values.filter((v) => v > 0).length / values.length) * 100).toFixed(0)}%  median ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}  worst ${sorted[0].toFixed(2)}`,
  );
}

// Hourly realized vol over the `days` before `endTs`, annualized.
function hourlyRv(endTs, days) {
  let sum = 0;
  let count = 0;
  for (let h = days * 24; h > 0; h -= 1) {
    const a = closes.get(endTs - h * H);
    const b = closes.get(endTs - (h - 1) * H);
    if (a && b) {
      sum += Math.log(b / a) ** 2;
      count += 1;
    }
  }
  return Math.sqrt((sum / count) * 24 * 365);
}

// Daily-close realized vol and the scanner's forecast (7D RV decaying to 180D, 14-day half-life).
function dailyRv(endTs, days) {
  const series = [];
  for (let i = days; i >= 0; i -= 1) {
    const price = closes.get(endTs - i * D);
    if (price) series.push(price);
  }
  let sum = 0;
  for (let i = 1; i < series.length; i += 1) sum += Math.log(series[i] / series[i - 1]) ** 2;
  return Math.sqrt((sum / (series.length - 1)) * 365);
}
function forecast(endTs, dteDays) {
  const rv7 = dailyRv(endTs, 7);
  const longRun = dailyRv(endTs, 180);
  const kappa = Math.LN2 / 14;
  const weight = (1 - Math.exp(-kappa * dteDays)) / (kappa * dteDays);
  return Math.sqrt(longRun ** 2 + (rv7 ** 2 - longRun ** 2) * weight);
}

console.log('== Weekend vs weekday hourly variance (2021–26)');
const variance = {};
for (const [ts, close] of perp) {
  const previous = closes.get(ts - H);
  const hour = new Date(ts - H);
  if (!previous || hour.getUTCFullYear() < 2021) continue;
  const key = `${hour.getUTCFullYear()}:${[0, 6].includes(hour.getUTCDay()) ? 'we' : 'wd'}`;
  const pooled = key.split(':')[1];
  for (const bucket of [key, pooled]) {
    variance[bucket] ??= [0, 0];
    variance[bucket][0] += Math.log(close / previous) ** 2;
    variance[bucket][1] += 1;
  }
}
const v = (key) => variance[key][0] / variance[key][1];
for (const year of [2021, 2022, 2023, 2024, 2025, 2026]) {
  console.log(`${year}  Sat–Sun / Mon–Fri UTC ${(v(`${year}:we`) / v(`${year}:wd`)).toFixed(2)}`);
}
console.log(`pooled ${(v('we') / v('wd')).toFixed(3)}`);

for (const row of rows) {
  const entryTs = Date.parse(row.fri) + ENTRY_H * H;
  row.rv7 = hourlyRv(entryTs, 7);
  row.rv30 = hourlyRv(entryTs, 30);
  row.forecast = forecast(entryTs, 7);
  const fee = (premium) => Math.min(TAKER * row.S0, FEE_CAP * premium);
  const shortCost =
    2 * fee(row.V0 / 2) + 2 * fee(Math.max(row.V1 / 2, 1)) + 2 * HALF_SPREAD * (row.S0 + row.S1);
  row.shortNetPct = ((row.pnlMid - shortCost) / row.S0) * 100;
  if (row.ST != null) {
    const debit = row.V0 + 2 * fee(row.V0 / 2) + 2 * HALF_SPREAD * row.S0;
    const intrinsic = Math.abs(row.ST - row.K);
    const payoff = intrinsic - Math.min(SETTLEMENT * row.ST, FEE_CAP * intrinsic);
    row.longRoiPct = ((payoff - debit) / debit) * 100;
  }
}

console.log(`\n== Short straddle, Fri ${ENTRY_H}:00 → exit offset ${EXIT_H}h, net % of spot`);
summary('all weeks', rows.map((row) => row.shortNetPct));
const edge = (row) => row.iv0 - Math.max(row.rv7, row.rv30);
for (const threshold of [0, 0.03, 0.05, 0.08]) {
  summary(
    `IV > max(RV7,RV30)+${threshold * 100}pt & RV7<=RV30`,
    rows.filter((row) => edge(row) > threshold && row.rv7 <= row.rv30).map((row) => row.shortNetPct),
  );
}
console.log(`mean IV change entry→exit ${(mean(rows.map((row) => row.iv1 - row.iv0)) * 100).toFixed(1)} pts`);

if (ENTRY_H === 8) {
  const held = rows.filter((row) => row.longRoiPct != null);
  console.log('\n== Long 7D straddle held to expiry, return % of debit');
  summary('all weeks', held.map((row) => row.longRoiPct));
  const belowRealized = (row) => row.iv0 - Math.min(row.rv7, row.rv30);
  summary('IV < max(RV7,RV30)', held.filter((row) => row.iv0 < Math.max(row.rv7, row.rv30)).map((row) => row.longRoiPct));
  summary('IV < min(RV7,RV30) − 5pt', held.filter((row) => belowRealized(row) < -0.05).map((row) => row.longRoiPct));
  for (const threshold of [0, -0.05, -0.1]) {
    summary(
      `IV − forecast < ${threshold * 100}pt`,
      held.filter((row) => row.iv0 - row.forecast < threshold).map((row) => row.longRoiPct),
    );
  }
}
