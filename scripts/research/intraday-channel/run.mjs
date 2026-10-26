import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { BAR_MS, PARAMETERS, backtest, channel, summarize, touchCounts } from './model.mjs';

const require = createRequire(new URL('../../../packages/core/package.json', import.meta.url));
const { z } = require('zod');
const log = require('pino')();
const length = z.coerce.number().int().positive().max(288).parse(process.argv[2] ?? PARAMETERS.length);
const multiplier = z.coerce.number().positive().max(20).parse(process.argv[3] ?? PARAMETERS.multiplier);
const parameters = { ...PARAMETERS, length, multiplier };
const runId = `${length}-${multiplier}`;
const DAY = 86_400_000;
const END = Date.UTC(2026, 9, 26);
const START = END - 180 * DAY;
const SPLIT = END - 60 * DAY;
const WARMUP_START = START - 5 * DAY;
const CACHE = new URL('./.cache/', import.meta.url);
const Candle = z.object({ timestamp: z.number().int(), open: z.number().positive(), high: z.number().positive(), low: z.number().positive(), close: z.number().positive() }).refine(c => c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close));
const Candles = z.array(Candle);
const Prices = z.array(z.number().positive());
const Response = z.object({ result: z.object({ status: z.literal('ok'), ticks: z.array(z.number().int()), open: Prices, high: Prices, low: Prices, close: Prices }) });

await fs.mkdir(CACHE, { recursive: true });

async function fetchChunk(from, to) {
  const file = new URL(`candles-${from}-${to}.json`, CACHE);
  try {
    return Candles.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const url = new URL('https://www.deribit.com/api/v2/public/get_tradingview_chart_data');
  url.search = new URLSearchParams({ instrument_name: 'BTC-PERPETUAL', resolution: '5', start_timestamp: String(from), end_timestamp: String(to - 1) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Public candles HTTP ${response.status}`);
      const { result } = Response.parse(await response.json());
      if ([result.open, result.high, result.low, result.close].some(a => a.length !== result.ticks.length)) throw new Error('Unequal candle array lengths');
      const candles = Candles.parse(result.ticks.map((timestamp, i) => ({ timestamp, open: result.open[i], high: result.high[i], low: result.low[i], close: result.close[i] }))).filter(c => c.timestamp >= from && c.timestamp < to);
      if (candles.length !== (to - from) / BAR_MS) throw new Error(`Incomplete chunk: expected ${(to - from) / BAR_MS}, received ${candles.length}`);
      await fs.writeFile(file, JSON.stringify(candles));
      return candles;
    } catch (error) {
      if (attempt === 2) throw error;
      log.warn({ attempt, error: String(error) }, 'retrying public candles');
      await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
    }
  }
}

const candles = [];
for (let from = WARMUP_START; from < END; from += 5 * DAY) {
  candles.push(...await fetchChunk(from, Math.min(from + 5 * DAY, END)));
}
for (let i = 0; i < candles.length; i++) {
  if (candles[i].timestamp !== WARMUP_START + i * BAR_MS) throw new Error(`Non-contiguous candles at ${i}`);
}
const bands = channel(candles, parameters);
const summary = {
  instrument: 'BTC-PERPETUAL',
  source: 'https://docs.deribit.com/api-reference/market-data/public-get_tradingview_chart_data',
  parameters: { ...parameters, candleMinutes: 5, gammaFilter: false, trendFilter: false },
  data: { startInclusive: new Date(START).toISOString(), endExclusive: new Date(END).toISOString(), warmupBars: (START - WARMUP_START) / BAR_MS, testedBars: (END - START) / BAR_MS, missingBars: 0, sha256: createHash('sha256').update(JSON.stringify(candles)).digest('hex') },
  costModel: {
    roundTripBps: 9,
    currentStandardTakerFeeBpsPerSide: 3.5,
    assumedSpreadSlippageBpsPerSide: 1,
    feeSource: 'https://support.deribit.com/hc/en-us/articles/25944746248989-Fees',
    scope: 'Fixed basis-point friction sensitivity on underlying price returns; current fees applied as a scenario, not reconstructed historical charges. Excludes funding, collateral, liquidation, option premiums, and execution-size impact.',
  },
  periods: {},
};
for (const [name, from, to] of [['first120Days', START, SPLIT], ['last60Days', SPLIT, END], ['all180Days', START, END]]) {
  const result = backtest(candles, bands, from, to, parameters);
  summary.periods[name] = {
    startInclusive: new Date(from).toISOString(), endExclusive: new Date(to).toISOString(),
    touches: touchCounts(candles, bands, from, to),
    ...summarize(result.trades, from, to),
    skippedEntryGaps: result.skippedEntryGaps,
    skippedEndOfWindow: result.skippedEndOfWindow,
  };
  await fs.writeFile(new URL(`${runId}-${name}-trades.json`, CACHE), JSON.stringify(result.trades, null, 2));
}
await fs.writeFile(new URL(`${runId}-chart-data.json`, CACHE), JSON.stringify(candles.slice(-864).map((c, i) => ({ ...c, ...bands[candles.length - 864 + i] }))));
await fs.writeFile(new URL(`./results-${runId}.json`, import.meta.url), JSON.stringify(summary, null, 2) + '\n');
log.info(summary, 'channel study complete');
