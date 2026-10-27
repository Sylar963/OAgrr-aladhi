import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { BAR_MS } from './model.mjs';

const require = createRequire(new URL('../../../packages/core/package.json', import.meta.url));
const { z } = require('zod');
const Candle = z.object({ timestamp: z.number().int(), open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive() }).refine(c => c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close));
const Candles = z.array(Candle);
const Prices = z.array(z.number().positive());
const Response = z.object({ result: z.object({ status: z.literal('ok'), ticks: z.array(z.number().int()), open: Prices, high: Prices, low: Prices, close: Prices }) });
const CACHE = new URL('./.cache/', import.meta.url);

export async function loadHistory(from, to) {
  await fs.mkdir(CACHE, { recursive: true });
  const candles = [];
  for (let start = from; start < to; start += 5 * 86_400_000) {
    const end = Math.min(start + 5 * 86_400_000, to);
    const file = new URL(`candles-${start}-${end}.json`, CACHE);
    let chunk;
    try { chunk = Candles.parse(JSON.parse(await fs.readFile(file, 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const url = new URL('https://www.deribit.com/api/v2/public/get_tradingview_chart_data');
      url.search = new URLSearchParams({ instrument_name: 'BTC-PERPETUAL', resolution: '5', start_timestamp: String(start), end_timestamp: String(end - 1) });
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`Candle HTTP ${response.status}`);
          const { result } = Response.parse(await response.json());
          if ([result.open, result.high, result.low, result.close].some(a => a.length !== result.ticks.length)) throw new Error('Unequal candle arrays');
          chunk = Candles.parse(result.ticks.map((timestamp, i) => ({ timestamp, open: result.open[i], high: result.high[i], low: result.low[i], close: result.close[i] }))).filter(c => c.timestamp >= start && c.timestamp < end);
          if (chunk.length !== (end - start) / BAR_MS) throw new Error('Incomplete candle chunk');
          await fs.writeFile(file, JSON.stringify(chunk));
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    candles.push(...chunk);
  }
  if (candles.length !== (to - from) / BAR_MS) throw new Error('Incomplete study window');
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].timestamp !== from + i * BAR_MS) throw new Error('Non-contiguous candles');
  }
  return candles;
}
