import { assessBotMarket, getRegisteredVenues } from '@oggregator/core';
import {
  BotMarketQuerySchema,
  BotMarketResponseSchema,
  botDataJsonSchemas,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { chainEngines } from '../chain-engines.js';
import { newsDelivery, newsService } from '../services.js';

export async function botRoute(app: FastifyInstance) {
  const schemas = botDataJsonSchemas();
  app.get('/bot/schema', async () => schemas);

  app.get('/bot/status', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const health = newsService?.getHealth() ?? null;
    return {
      generatedAt: Date.now(),
      marketVenues: getRegisteredVenues(),
      news: {
        health,
        cursor: newsDelivery.cursor,
        oldestCursor: newsDelivery.oldestCursor,
        retainedEvents: newsDelivery.size,
        classificationIsSentiment: false,
        sourceVerification: 'not-provided',
        affectedAssets: 'not-provided',
        directionalSignal: 'not-provided',
        corrections: 'observed-content-revisions-only',
      },
      endpoints: {
        schemas: '/api/bot/schema',
        news: '/api/news/events',
        macroHeadlines: '/api/news/macro',
        newsStream: '/ws/news',
        market: '/api/bot/market',
        depth: '/api/bot/depth',
        chainStream: '/ws/chain',
        historicalNews: '/api/news/archive',
        historicalTrades: '/api/flow/history',
        liquidity: '/api/liquidity',
        portfolio: '/api/portfolio/positions',
      },
      access: {
        publicMarketData: true,
        privateAccount: 'Clerk bearer token required',
        httpRequestsPerMinutePerIp: 600,
        liquidityRequestsPerMinutePerIp: 60,
      },
      capabilities: {
        arrivalOrderedReplay: true,
        rawClassifications: true,
        quoteQuality: true,
        macroCalendar: false,
        reportedMacroHeadlineFigures: true,
        completeHistoricalQuoteReplay: false,
        verifiedAccountFees: false,
        genericMultiVenueDepth: true,
        depthMode: 'public-snapshots',
        continuousDepth: false,
        thalexDepth: 'requires-available-book-session',
      },
    };
  });

  app.get(
    '/bot/market',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = BotMarketQuerySchema.safeParse(req.query);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: 'invalid_bot_market_query', issues: parsed.error.issues });
      const query = parsed.data;
      reply.header('Cache-Control', 'no-store');
      const acquired = await chainEngines.acquire(query);
      try {
        const chain = await acquired.runtime.fetchSnapshotData();
        const generatedAt = Date.now();
        const states = Object.fromEntries(
          acquired.runtime.getHealth().map((venue) => [venue.venue, venue.state]),
        );
        return BotMarketResponseSchema.parse({
          generatedAt,
          ...assessBotMarket(chain, query, states, generatedAt),
          thresholds: {
            maxQuoteAgeMs: query.maxQuoteAgeMs,
            maxSpreadPct: query.maxSpreadPct,
            requireGreeks: query.requireGreeks,
          },
          units: {
            price: 'USD per base unit',
            quantity: 'base',
            iv: 'fraction',
            feeBasis: 'estimated-public-schedule',
            executionFields: 'chain.strikes[].call|put.venues[venue].execution',
          },
          chain,
          failedVenues: acquired.runtime.getFailedVenues(),
          venueHealth: acquired.runtime.getHealthDetails(),
        });
      } finally {
        await acquired.release();
      }
    },
  );
}
